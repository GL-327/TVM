#include "platform/video_texture.h"

#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mmsystem.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstring>
#include <utility>

#include <nlohmann/json.hpp>

#include "core/http.h"
#include "core/util.h"

namespace tvm::platform {

namespace {

using Clock = std::chrono::steady_clock;
using namespace std::chrono_literals;
constexpr DWORD kPicture = static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM);
constexpr DWORD kSound = static_cast<DWORD>(MF_SOURCE_READER_FIRST_AUDIO_STREAM);
constexpr LONGLONG kSecond = 10000000;
thread_local VideoTexture* currentTexture = nullptr;

std::string PreviewQuery(const std::string& id) { return "?id=" + id; }

struct Foundation {
    HRESULT apartment = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool ready = SUCCEEDED(apartment) && SUCCEEDED(MFStartup(MF_VERSION));
    ~Foundation() {
        if (ready) MFShutdown();
        if (SUCCEEDED(apartment)) CoUninitialize();
    }
};

bool Rewind(IMFSourceReader* reader) {
    PROPVARIANT position{};
    position.vt = VT_I8;
    position.hVal.QuadPart = 0;
    return SUCCEEDED(reader->SetCurrentPosition(GUID_NULL, position));
}

bool SizeOf(IMFSourceReader* reader, UINT32& width, UINT32& height, LONG& stride) {
    ComPtr<IMFMediaType> type;
    UINT32 strideBits = 0;
    if (FAILED(reader->GetCurrentMediaType(kPicture, &type)) ||
        FAILED(MFGetAttributeSize(type.Get(), MF_MT_FRAME_SIZE, &width, &height)) ||
        width < 1 || width > 1920 || height < 1 || height > 1080) return false;
    if (SUCCEEDED(type->GetUINT32(MF_MT_DEFAULT_STRIDE, &strideBits))) {
        static_assert(sizeof(stride) == sizeof(strideBits));
        std::memcpy(&stride, &strideBits, sizeof(stride));
    } else {
        stride = -static_cast<LONG>(width * 4U);
    }
    return true;
}

bool CopyPicture(IMFSample* sample, UINT32 width, UINT32 height, LONG stride, std::vector<BYTE>& pixels) {
    ComPtr<IMFMediaBuffer> buffer;
    if (FAILED(sample->ConvertToContiguousBuffer(&buffer))) return false;
    const auto rowBytes = static_cast<std::size_t>(width) * 4U;
    pixels.resize(rowBytes * height);
    const auto copy = [&](const BYTE* row, LONG pitch) {
        if (static_cast<std::size_t>(std::abs(static_cast<long long>(pitch))) < rowBytes) return false;
        for (UINT32 y = 0; y < height; ++y)
            std::memcpy(pixels.data() + y * rowBytes, row + static_cast<std::ptrdiff_t>(y) * pitch, rowBytes);
        return true;
    };
    ComPtr<IMF2DBuffer> image;
    BYTE* row = nullptr;
    LONG pitch = 0;
    if (SUCCEEDED(buffer.As(&image)) && SUCCEEDED(image->Lock2D(&row, &pitch))) {
        const bool read = copy(row, pitch);
        image->Unlock2D();
        return read;
    }
    DWORD length = 0;
    if (FAILED(buffer->Lock(&row, nullptr, &length))) return false;
    const auto step = static_cast<std::size_t>(std::abs(static_cast<long long>(stride)));
    const bool read = step * height <= length && copy(row + (stride < 0 ? (height - 1U) * step : 0U), stride);
    buffer->Unlock();
    return read;
}

// The MP4 may itself be silent. When Core includes a sound track, queue small PCM blocks on the same clock as
// the picture. Muting immediately drops queued audio while the reader keeps both stream positions aligned.
class PreviewAudio {
public:
    ~PreviewAudio() {
        if (!output_) return;
        Reset();
        waveOutClose(output_);
    }

    bool Open(IMFSourceReader* reader) {
        ComPtr<IMFMediaType> type;
        if (FAILED(reader->GetNativeMediaType(kSound, 0, &type))) return false;
        type.Reset();
        if (FAILED(MFCreateMediaType(&type)) || FAILED(type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio)) ||
            FAILED(type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM)) ||
            FAILED(reader->SetStreamSelection(kSound, TRUE)) ||
            FAILED(reader->SetCurrentMediaType(kSound, nullptr, type.Get()))) {
            reader->SetStreamSelection(kSound, FALSE);
            return false;
        }
        type.Reset();
        WAVEFORMATEX* format = nullptr;
        if (FAILED(reader->GetCurrentMediaType(kSound, &type)) ||
            FAILED(MFCreateWaveFormatExFromMFMediaType(type.Get(), &format, nullptr, MFWaveFormatExConvertFlag_Normal))) {
            reader->SetStreamSelection(kSound, FALSE);
            return false;
        }
        const auto result = waveOutOpen(&output_, WAVE_MAPPER, format, 0, 0, CALLBACK_NULL);
        CoTaskMemFree(format);
        if (result != MMSYSERR_NOERROR) {
            output_ = nullptr;
            reader->SetStreamSelection(kSound, FALSE);
        }
        return output_ != nullptr;
    }

    void Reset() {
        if (!output_) return;
        waveOutReset(output_);
        for (auto& packet : packets_) Release(packet);
    }

    bool Queue(IMFSample* sample) {
        Packet* available = nullptr;
        for (auto& packet : packets_) {
            if (packet.header.dwFlags & WHDR_DONE) Release(packet);
            if (!available && (packet.header.dwFlags & WHDR_PREPARED) == 0) available = &packet;
        }
        if (!available) return false;
        ComPtr<IMFMediaBuffer> buffer;
        BYTE* bytes = nullptr;
        DWORD length = 0;
        if (FAILED(sample->ConvertToContiguousBuffer(&buffer)) || FAILED(buffer->Lock(&bytes, nullptr, &length)))
            return false;
        available->bytes.assign(bytes, bytes + length);
        buffer->Unlock();
        available->header.lpData = available->bytes.data();
        available->header.dwBufferLength = length;
        if (waveOutPrepareHeader(output_, &available->header, sizeof(WAVEHDR)) != MMSYSERR_NOERROR) return false;
        if (waveOutWrite(output_, &available->header, sizeof(WAVEHDR)) == MMSYSERR_NOERROR) return true;
        Release(*available);
        return false;
    }

private:
    struct Packet { WAVEHDR header{}; std::vector<char> bytes; };
    void Release(Packet& packet) {
        if (packet.header.dwFlags & WHDR_PREPARED) waveOutUnprepareHeader(output_, &packet.header, sizeof(WAVEHDR));
        packet.header = {};
    }

    HWAVEOUT output_ = nullptr;
    std::array<Packet, 16> packets_;
};

}  // namespace

VideoTexture::VideoTexture(std::string coreOrigin) : origin_(std::move(coreOrigin)),
        worker_([this](std::stop_token stop) { Run(stop); }) {
    currentTexture = this;
}

VideoTexture::~VideoTexture() {
    currentTexture = nullptr;
    worker_.request_stop();
    changed_.notify_all();
    worker_.join();
}

VideoTexture* VideoTexture::Current() { return currentTexture; }

void VideoTexture::Update(const std::string& id, bool playing, bool muted) {
    {
        std::scoped_lock lock(mutex_);
        if (id == id_ && playing == playing_ && muted == muted_) return;
        if (id != id_) {
            id_ = id;
            ++generation_;
            latest_.reset();
            hasAudio_ = false;
        }
        playing_ = playing;
        muted_ = muted;
    }
    changed_.notify_all();
}

bool VideoTexture::Ready() const {
    std::scoped_lock lock(mutex_);
    return playing_ && latest_ != nullptr;
}

void VideoTexture::ClearBitmap() {
    bitmap_.Reset();
    bitmapTarget_ = nullptr;
    uploaded_.reset();
}

bool VideoTexture::Draw(ID2D1RenderTarget* target, const ui::Box& box, double opacity, double focusX, double focusY) {
    std::shared_ptr<Frame> frame;
    {
        std::scoped_lock lock(mutex_);
        if (!playing_) return false;
        frame = latest_;
    }
    if (!frame || opacity <= 0.0 || box.width <= 0.0 || box.height <= 0.0) return false;
    if (target != bitmapTarget_ || !bitmap_ || frame->width != uploaded_->width || frame->height != uploaded_->height) {
        ClearBitmap();
        const auto properties = D2D1::BitmapProperties(D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_IGNORE), 96, 96);
        if (FAILED(target->CreateBitmap(D2D1::SizeU(frame->width, frame->height), frame->pixels.data(),
                                        frame->width * 4U, properties, &bitmap_))) return false;
        bitmapTarget_ = target;
        uploaded_ = frame;
    } else if (frame != uploaded_) {
        if (FAILED(bitmap_->CopyFromMemory(nullptr, frame->pixels.data(), frame->width * 4U))) return false;
        uploaded_ = frame;
    }
    const double scale = std::max(box.width / frame->width, box.height / frame->height);
    const double width = box.width / scale;
    const double height = box.height / scale;
    const double left = (frame->width - width) * focusX;
    const double top = (frame->height - height) * focusY;
    target->DrawBitmap(bitmap_.Get(), D2D1::RectF(static_cast<float>(box.x), static_cast<float>(box.y),
                       static_cast<float>(box.Right()), static_cast<float>(box.Bottom())), static_cast<float>(opacity),
                       D2D1_BITMAP_INTERPOLATION_MODE_LINEAR, D2D1::RectF(static_cast<float>(left), static_cast<float>(top),
                       static_cast<float>(left + width), static_cast<float>(top + height)));
    return true;
}

void VideoTexture::Run(std::stop_token stop) {
    const Foundation foundation;
    if (!foundation.ready) return;
    unsigned completed = 0;
    while (!stop.stop_requested()) {
        std::unique_lock lock(mutex_);
        changed_.wait(lock, stop, [&] { return playing_ && !id_.empty() && generation_ != completed; });
        if (stop.stop_requested()) break;
        const auto generation = generation_;
        const auto query = PreviewQuery(id_);
        lock.unlock();

        http::Options options;
        options.accept = "application/json";
        options.timeoutMs = 1500;
        options.maxBytes = 32 * 1024;
        options.followRedirects = false;
        const auto prefs = http::Get(origin_ + "/api/prefs", options);
        if (prefs && prefs->ok()) {
            const auto body = nlohmann::json::parse(prefs->body, nullptr, false);
            if (body.is_object() && body.contains("heroPreviews") && body["heroPreviews"] == false) {
                lock.lock();
                changed_.wait_for(lock, stop, 5s, [&] { return generation_ != generation || !playing_; });
                continue;
            }
        }

        const auto deadline = Clock::now() + 2min;
        while (!stop.stop_requested()) {
            lock.lock();
            changed_.wait(lock, stop, [&] { return generation_ != generation || playing_; });
            const bool valid = !stop.stop_requested() && generation_ == generation;
            lock.unlock();
            if (!valid) break;
            const auto response = http::Get(origin_ + "/api/extras/hero-clip" + query, options);
            if (response && response->status == 404) break;
            if (response && response->status == 200) {
                const auto body = nlohmann::json::parse(response->body, nullptr, false);
                if (body.is_object() && body.contains("status") && body["status"] == "ready") {
                    // The transport stays on the local Core. The well-known MP4 route serves byte ranges for seeking.
                    Decode(stop, util::ToWide(origin_ + "/api/extras/hero-clip.mp4" + query), generation);
                }
                break;
            }
            if (Clock::now() >= deadline || (response && response->status != 202)) break;
            lock.lock();
            changed_.wait_for(lock, stop, 5s, [&] { return generation_ != generation || !playing_; });
            lock.unlock();
        }
        completed = generation;
        lock.lock();
        if (generation_ == generation) {
            latest_.reset();
            hasAudio_ = false;
        }
    }
}

bool VideoTexture::Decode(std::stop_token stop, const std::wstring& url, unsigned generation) {
    ComPtr<IMFAttributes> attributes;
    ComPtr<IMFSourceReader> reader;
    if (FAILED(MFCreateAttributes(&attributes, 1)) ||
        FAILED(attributes->SetUINT32(MF_SOURCE_READER_ENABLE_ADVANCED_VIDEO_PROCESSING, TRUE)) ||
        FAILED(MFCreateSourceReaderFromURL(url.c_str(), attributes.Get(), &reader))) return false;

    ComPtr<IMFMediaType> native;
    GUID codec{};
    if (FAILED(reader->GetNativeMediaType(kPicture, 0, &native)) || FAILED(native->GetGUID(MF_MT_SUBTYPE, &codec)) ||
        (codec != MFVideoFormat_H264 && codec != MFVideoFormat_H264_ES)) return false;
    ComPtr<IMFMediaType> output;
    if (FAILED(reader->SetStreamSelection(static_cast<DWORD>(MF_SOURCE_READER_ALL_STREAMS), FALSE)) ||
        FAILED(reader->SetStreamSelection(kPicture, TRUE)) ||
        FAILED(MFCreateMediaType(&output)) ||
        FAILED(output->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video)) ||
        FAILED(output->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32)) ||
        FAILED(reader->SetCurrentMediaType(kPicture, nullptr, output.Get()))) return false;

    UINT32 width = 0, height = 0;
    LONG stride = 0;
    if (!SizeOf(reader.Get(), width, height, stride)) return false;
    PreviewAudio audio;
    const bool sound = audio.Open(reader.Get());
    {
        std::scoped_lock lock(mutex_);
        if (generation_ != generation) return false;
        hasAudio_ = sound;
    }
    LONGLONG previous = -1;
    bool audioEnded = false;
    LONGLONG audioTime = 0;
    bool published = false;
    bool wasAudible = false;
    auto due = Clock::now();
    while (!stop.stop_requested()) {
        std::unique_lock lock(mutex_);
        if (generation_ != generation) return true;
        if (!playing_) {
            lock.unlock();
            audio.Reset();
            lock.lock();
            changed_.wait(lock, stop, [&] { return generation_ != generation || playing_; });
            due = Clock::now();
        }
        if (stop.stop_requested() || generation_ != generation) return true;
        const bool muted = muted_;
        lock.unlock();
        if (muted && wasAudible) audio.Reset();

        DWORD flags = 0;
        LONGLONG timestamp = 0;
        ComPtr<IMFSample> sample;
        if (FAILED(reader->ReadSample(kPicture, 0, nullptr, &flags, &timestamp, &sample)) ||
            (flags & MF_SOURCE_READERF_ERROR) != 0) return false;
        if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) {
            if (!published || !Rewind(reader.Get())) return false;
            audio.Reset();
            audioEnded = false;
            audioTime = 0;
            previous = -1;
            published = false;
            due = Clock::now();
            continue;
        }
        if ((flags & MF_SOURCE_READERF_CURRENTMEDIATYPECHANGED) != 0 && !SizeOf(reader.Get(), width, height, stride))
            return false;
        if (!sample) continue;

        const auto frame = std::make_shared<Frame>();
        frame->width = width;
        frame->height = height;
        if (!CopyPicture(sample.Get(), width, height, stride, frame->pixels)) return false;
        if (previous >= 0) {
            const auto delay = std::clamp(timestamp - previous, 10000LL, kSecond);
            due += std::chrono::nanoseconds(delay * 100);
            if (due < Clock::now() - 150ms) due = Clock::now();
        }
        previous = timestamp;

        lock.lock();
        changed_.wait_until(lock, stop, due, [&] { return generation_ != generation || !playing_ || muted_ != muted; });
        if (stop.stop_requested() || generation_ != generation) return true;
        if (playing_) {
            latest_ = frame;
            published = true;
        }
        const bool audible = playing_ && !muted_;
        lock.unlock();
        if (!audible && wasAudible) audio.Reset();
        wasAudible = audible;

        if (sound && !audioEnded) {
            // Drain enough audio for the current video frame, without running far ahead when a fade is starting.
            for (int packet = 0; packet < 12 && audioTime <= timestamp + kSecond / 12; ++packet) {
                DWORD audioFlags = 0;
                ComPtr<IMFSample> pcm;
                if (FAILED(reader->ReadSample(kSound, 0, nullptr, &audioFlags, &audioTime, &pcm)) ||
                    (audioFlags & (MF_SOURCE_READERF_ERROR | MF_SOURCE_READERF_ENDOFSTREAM)) != 0) {
                    audioEnded = true;
                    break;
                }
                if (pcm && audible && audioTime >= timestamp - kSecond / 7) audio.Queue(pcm.Get());
            }
        }
    }
    return true;
}

}  // namespace tvm::platform
