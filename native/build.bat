@echo off
rem Builds TVM for Windows and runs its tests. Needs Visual Studio 2022 Build Tools (C++ workload).
rem The app is written to build\tvm.exe, and the tests run from build\tvm_tests.exe.
setlocal
set "OLD_REPO=C:/Users/Gathe/Desktop/TVM"

call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set "PATH=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja;%PATH%"

cmake -S "%~dp0." -B "%~dp0build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DTVM_REPO_ROOT="%OLD_REPO%" || exit /b 1
cmake --build "%~dp0build" || exit /b 1
"%~dp0build\tvm_tests.exe" || exit /b 1
echo Built %~dp0build\tvm.exe
