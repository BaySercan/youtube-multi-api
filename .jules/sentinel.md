## 2026-01-24 - yt-dlp Argument Injection
**Vulnerability:** User input passed directly to `yt-dlp` as a URL argument allowed injecting flags (e.g., `--version`) because `spawn` does not prevent the target program from parsing options starting with `-`.
**Learning:** Even when using `spawn` (which prevents shell injection), argument injection is possible if the target CLI tool accepts options mixed with positional arguments or treats any argument starting with `-` as an option.
**Prevention:** Always validate input format (e.g. enforce URL structure) and use the `--` delimiter to explicitly separate options from positional arguments when invoking CLI tools.
