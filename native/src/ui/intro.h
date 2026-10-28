#pragma once

// The open sting over the app, from apps/ui/src/brand/TvmIntro.tsx and TvmIntro.css, in its two forms: 'tvm' for the
// app's launch, and 'stream' for TVM Stream. A light blooms, two rings ring out, the mark comes in on its rays, the
// word is written letter by letter, and the tag line follows ("WATCH", or "STREAM" in the stream form). Each form
// plays once per run. While the catalogue is still loading, the 'tvm' form holds on the mark. OK, Enter, Escape,
// Space, a click or a tap ends it.
//
// With reduced motion, motion.css cuts the animations to their end frames, so the sting shows its final frame
// and closes after a short hold.

#include "motion/preferences.h"
#include "ui/painter.h"

namespace tvm::ui {

class Intro {
public:
    // Which sting: the launch's ('tvm'), or TVM Stream's, which swaps the accent and the cool blue.
    enum class Form { Tvm, Stream };

    explicit Intro(motion::MotionSettings motion = {}, Form form = Form::Tvm);

    // While set, the sting holds on the mark once it has played, until the catalogue is ready.
    void SetPending(bool pending) { pending_ = pending; }

    // Starts the sting at `nowMs`. Later calls do nothing, so it plays once per run.
    void Start(double nowMs);
    // Whether the sting is on screen.
    bool Visible() const;
    // Whether frames are still needed. The sting moves for as long as it is on screen.
    bool Animating() const { return Visible(); }
    // Whether the sting is opaque over the whole window, so the screen under it need not be drawn.
    bool Covers() const;
    // Ends the sting now, as OK, Enter, Escape, Space, a click or a tap does.
    void Skip(double nowMs);
    // Advances the sting to `nowMs`.
    void Tick(double nowMs);

    void Paint(Painter& painter, double width, double height) const;

private:
    void BeginLeave(double nowMs);
    double LeaveMs() const;

    motion::MotionSettings motion_;
    Form form_;
    bool pending_ = false;
    bool started_ = false;
    bool animDone_ = false;
    bool holdStarted_ = false;
    bool leaving_ = false;
    bool finished_ = false;
    double startMs_ = 0.0;
    double clockMs_ = 0.0;
    double animDoneMs_ = 0.0;
    double holdStartMs_ = 0.0;
    double leaveMs_ = 0.0;
};

}  // namespace tvm::ui
