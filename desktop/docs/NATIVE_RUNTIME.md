# Matheca native image runtime

The phase 4 Windows x64 portable directory dynamically loads replaceable
`heif.dll` 1.23.2 and `libde265.dll` 1.1.1 beside Matheca.exe. No Node/Electron
helper process is used. Keep these DLLs and the included Visual C++ runtimes
with the EXE. LGPL texts are under licenses/native; Rust dependency licenses
and version/source inventory are included separately.

Upstream source and release build instructions:

- https://github.com/strukturag/libheif/releases/tag/v1.23.2
- https://github.com/strukturag/libheif/blob/v1.23.2/README.md
- https://github.com/strukturag/libde265/releases/tag/v1.1.1
- https://github.com/strukturag/libde265/blob/v1.1.1/README.md

To reproduce a native build, use an x64 MSVC CMake environment. Build libde265
1.1.1 as a shared library with tools/tests disabled and install to a dedicated
prefix. Configure libheif 1.23.2 with that prefix, BUILD_SHARED_LIBS=ON,
WITH_LIBDE265=ON, WITH_LIBDE265_PLUGIN=OFF, WITH_EXAMPLES=OFF, BUILD_TESTING=OFF,
and unwanted encoder/decoder backends disabled. Build and install Release.
Keep the decoder DLL, its dependent libde265 DLL, and the MSVC redistributable
files from the compiler's redist directory together. UCRT is supplied by Windows.
Replacement builds require HEIC fixture validation and explicit update of the
packaging SHA256 allowlist; do not silently substitute another runtime.

The current validated binary hashes are pinned in scripts/portable-tauri.mjs.
Set MATHECA_HEIF_BIN to their directory before packaging. These are the same
native versions used by the phase 1 probe; synthetic validation input and
upstream example.heic are not shipped as product data.

HTTPS uses the Windows trust store and verifies certificate hostnames. For a
private enterprise CA, a launch environment may supply MATHECA_HTTPS_CA with
an absolute path to a PEM CA certificate (up to 1 MiB). It adds a trusted root;
it never enables HTTP or disables TLS/hostname verification. Integration checks
use this facility for an isolated loopback HTTPS fixture without changing the
Windows certificate store or contacting a real AI service.
