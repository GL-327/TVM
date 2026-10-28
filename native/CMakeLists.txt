cmake_minimum_required(VERSION 3.25)

project(TVMNative LANGUAGES CXX)

# The folder of the Node app that this build mirrors. The version test reads its package.json.
# A copy outside the repository sets it on the command line.
set(TVM_REPO_ROOT "${PROJECT_SOURCE_DIR}/.." CACHE PATH "The TVM repository that this build mirrors")

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
  add_compile_options(/W4 /WX /EHsc /permissive- /utf-8)
  add_compile_definitions(UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

# Core runtime: configuration, storage and the local vault. No UI, no network.
add_library(tvm_core STATIC
  src/core/util.cpp
  src/core/util.h
  src/core/crypto.cpp
  src/core/crypto.h
  src/core/paths.cpp
  src/core/paths.h
  src/core/config.cpp
  src/core/config.h
  src/core/prefs.cpp
  src/core/prefs.h
  src/core/vault.cpp
  src/core/vault.h
  src/core/secrets.cpp
  src/core/secrets.h
  src/core/http.cpp
  src/core/http.h
  src/core/js.cpp
  src/core/js.h
  src/core/mpv.cpp
  src/core/mpv.h
  src/catalog/playback.cpp
  src/catalog/playback.h
  src/catalog/artwork.cpp
  src/catalog/artwork.h
  src/catalog/catalog_service.cpp
  src/catalog/catalog_service.h
  src/catalog/cinemeta.cpp
  src/catalog/cinemeta.h
  src/catalog/media_item.cpp
  src/catalog/media_item.h
  src/catalog/rails.cpp
  src/catalog/rails.h
  src/catalog/recommend.cpp
  src/catalog/recommend.h
  src/catalog/progress.cpp
  src/catalog/progress.h
  src/catalog/watchlist.cpp
  src/catalog/watchlist.h
  src/catalog/title.cpp
  src/catalog/title.h
  src/catalog/realdebrid.cpp
  src/catalog/realdebrid.h
  src/catalog/library.cpp
  src/catalog/library.h
  src/catalog/live_channel.h
  src/catalog/live.cpp
  src/catalog/live.h
  src/catalog/xtream.cpp
  src/catalog/xtream.h
  src/core/profiles.cpp
  src/core/profiles.h
  src/core/admin.cpp
  src/core/admin.h
  src/catalog/hubs.cpp
  src/catalog/hubs.h
  src/catalog/live_check.cpp
  src/catalog/live_check.h
)
# third_party is a system include so vendored headers do not raise our warnings.
target_include_directories(tvm_core SYSTEM PUBLIC third_party)
target_include_directories(tvm_core PUBLIC src)
target_link_libraries(tvm_core PUBLIC bcrypt crypt32 winhttp)

# Engine: remote intents, focus, motion and the widget tree. Pure logic with
# no Win32 calls, so it is tested directly with a recording painter.
add_library(tvm_engine STATIC
  src/motion/camera.cpp
  src/motion/camera.h
  src/motion/easing.cpp
  src/motion/easing.h
  src/motion/preferences.cpp
  src/motion/preferences.h
  src/motion/timeline.cpp
  src/motion/timeline.h
  src/motion/tween.cpp
  src/motion/tween.h
  src/nav/focus_tree.cpp
  src/nav/focus_tree.h
  src/nav/hop_queue.cpp
  src/nav/hop_queue.h
  src/nav/intents.cpp
  src/nav/intents.h
  src/nav/wrap.cpp
  src/nav/wrap.h
  src/nav/pointer.cpp
  src/nav/pointer.h
  src/nav/view_stack.cpp
  src/nav/view_stack.h
  src/ui/catalog_view.cpp
  src/ui/catalog_view.h
  src/ui/details_screen.cpp
  src/ui/details_screen.h
  src/ui/painter.h
  src/ui/pages.cpp
  src/ui/pages.h
  src/ui/pending_screen.cpp
  src/ui/pending_screen.h
  src/ui/player_screen.cpp
  src/ui/player_screen.h
  src/ui/preferences_store.cpp
  src/ui/preferences_store.h
  src/ui/button_focus.cpp
  src/ui/button_focus.h
  src/ui/stage.cpp
  src/ui/stage.h
  src/ui/intro.cpp
  src/ui/intro.h
  src/ui/live_playlist_screen.cpp
  src/ui/live_playlist_screen.h
  src/ui/live_tv_view.cpp
  src/ui/live_tv_view.h
  src/ui/realdebrid_screen.cpp
  src/ui/realdebrid_screen.h
  src/ui/xtream_screen.cpp
  src/ui/xtream_screen.h
  src/ui/screen.h
  src/ui/screen_base.h
  src/ui/settings_screen.cpp
  src/ui/settings_screen.h
  src/ui/shell.cpp
  src/ui/shell.h
  src/ui/scene.cpp
  src/ui/scene.h
  src/ui/widget.cpp
  src/ui/widget.h
)
target_include_directories(tvm_engine PUBLIC src)
target_link_libraries(tvm_engine PUBLIC tvm_core)

# Platform: the window, the frame loop, Direct2D drawing and PNG snapshots.
add_library(tvm_platform STATIC
  src/platform/app.cpp
  src/platform/app_pages.cpp
  src/platform/artwork_store.cpp
  src/platform/artwork_store.h
  src/platform/background.cpp
  src/platform/background.h
  src/platform/image_cache.cpp
  src/platform/image_cache.h
  src/platform/app.h
  src/platform/assets.cpp
  src/platform/assets.h
  src/platform/d2d_painter.cpp
  src/platform/d2d_painter.h
  src/platform/mpv_player.cpp
  src/platform/mpv_player.h
  src/platform/overlay_window.cpp
  src/platform/overlay_window.h
  src/platform/graphics.cpp
  src/platform/graphics.h
  src/platform/snapshot.cpp
  src/platform/snapshot.h
)
target_link_libraries(tvm_platform PUBLIC tvm_engine d2d1 dwrite windowscodecs ole32 shell32 user32 gdi32)

add_executable(tvm WIN32 src/main.cpp)
target_link_libraries(tvm PRIVATE tvm_platform)

enable_testing()

add_executable(tvm_tests
  tests/main.cpp
  tests/core_tests.cpp
  tests/nav_tests.cpp
  tests/motion_tests.cpp
  tests/ui_tests.cpp
  tests/view_stack_tests.cpp
  tests/pointer_tests.cpp
  tests/shell_tests.cpp
  tests/preferences_store_tests.cpp
  tests/catalog_tests.cpp
  tests/library_tests.cpp
  tests/realdebrid_tests.cpp
  tests/xtream_tests.cpp
  tests/live_tests.cpp
  tests/live_screen_tests.cpp
  tests/live_playlist_screen_tests.cpp
  tests/button_focus_tests.cpp
  tests/hero_tests.cpp
  tests/stage_tests.cpp
  tests/intro_tests.cpp
  tests/playback_tests.cpp
  tests/player_tests.cpp
  tests/pages_tests.cpp
)
target_link_libraries(tvm_tests PRIVATE tvm_engine)
target_compile_definitions(tvm_tests PRIVATE
  "TVM_REPO_ROOT=\"${TVM_REPO_ROOT}\""
  "TVM_TEST_DIR=\"${PROJECT_SOURCE_DIR}/tests\"")
add_test(NAME native COMMAND tvm_tests)

# Read-only check that an existing data directory opens with this build.
add_executable(tvm_probe tools/probe.cpp)
target_link_libraries(tvm_probe PRIVATE tvm_core)

# Writes watch progress into a scratch folder, for checking the Continue watching
# shelf on screen before playback is ported. It refuses the viewer's own folder.
add_executable(tvm_seed_progress tools/seed_progress.cpp)
target_link_libraries(tvm_seed_progress PRIVATE tvm_core)

# Live check of the catalogue against Cinemeta. It needs the internet and
# writes only to a temporary folder.
add_executable(tvm_catalog_check tools/catalog_check.cpp)
target_link_libraries(tvm_catalog_check PRIVATE tvm_core)
