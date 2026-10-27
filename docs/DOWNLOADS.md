# Downloading films and episodes

Restart TVM after updating so the desktop folder picker is loaded.

Open a film or series and choose **Download**. A series offers the full series,
one season or one episode. Each episode also has its own Download button.
Choose an audio language, maximum source quality and a folder, then start the
download. **TVM Stream → Downloads** opens the queue again. The player also has
a Download button, which pauses playback while opening the options.

Downloads run sequentially in the background while you browse. Progress, errors,
Cancel and Show file are available in the queue. Keep TVM open until they finish;
the queue is held for the current app session. Completed files remain in the
chosen folder after closing the app. Existing files are preserved with numbered
filenames. Failed/cancelled partial files are removed.

Language and quality select matching provider releases; availability varies by
title and episode. A requested language must appear in the source metadata.
Original / any language accepts any release. Files retain their original
container and all embedded audio and subtitle tracks. This does not translate
audio, add subtitles, or convert the file. Unavailable episodes report their own
error and the rest of the batch continues. The connected media account and
source must supply a downloadable file; live streams are excluded.

The desktop shell uses the operating system's folder picker. Chrome/Edge can
also save through the File System Access directory picker on a secure local
origin; keep the browser tab open. Browsers without that API show a compatibility
message. The iOS/Android shells do not currently expose a native downloads bridge.
