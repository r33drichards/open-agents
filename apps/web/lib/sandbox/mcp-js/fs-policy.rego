# Filesystem policy for mcp-js per-session sandboxes.
#
# Each session's run_js executes against its OWN content-addressed filesystem
# overlay (mounted per session and isolated from every other session), so the
# overlay itself is the security boundary. Within that overlay we allow all
# filesystem operations. Tighten this (e.g. restrict to the working directory)
# if sessions ever share an overlay.
package mcp.filesystem

default allow = true
