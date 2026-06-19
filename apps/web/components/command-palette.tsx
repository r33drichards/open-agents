"use client";

import {
  Home,
  LayoutGrid,
  Moon,
  Plus,
  Settings,
  Sun,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useCommandPalette } from "@/hooks/use-command-palette";
import { useSession } from "@/hooks/use-session";
import { useTheme } from "@/hooks/use-theme";
import { useSessions } from "@/hooks/use-sessions";

const MAX_RECENT_SESSIONS = 5;

/**
 * Global ⌘K command palette. Mounted once at the app root so the shortcut is
 * available on every page. Surfaces quick navigation, recent sessions, and a
 * theme toggle.
 */
export function CommandPalette() {
  const { open, setOpen } = useCommandPalette();
  const router = useRouter();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { isAuthenticated } = useSession();
  const { sessions } = useSessions({ enabled: isAuthenticated && open });

  const runCommand = useCallback(
    (command: () => void) => {
      setOpen(false);
      command();
    },
    [setOpen],
  );

  const recentSessions = sessions.slice(0, MAX_RECENT_SESSIONS);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/"))}
            keywords={["home"]}
          >
            <Home />
            <span>Home</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/sessions"))}
            keywords={["sessions", "tasks"]}
          >
            <LayoutGrid />
            <span>Sessions</span>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/settings"))}
            keywords={["settings", "preferences"]}
          >
            <Settings />
            <span>Settings</span>
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => runCommand(() => router.push("/settings/profile"))}
            keywords={["profile", "account"]}
          >
            <User />
            <span>Profile</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem
            onSelect={() => runCommand(() => router.push("/"))}
            keywords={["new", "create", "session", "task"]}
          >
            <Plus />
            <span>New session</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              runCommand(() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark"),
              )
            }
            keywords={["theme", "dark", "light", "mode", "appearance"]}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />}
            <span>
              Switch to {resolvedTheme === "dark" ? "light" : "dark"} mode
            </span>
            {theme === "system" ? (
              <CommandShortcut>system</CommandShortcut>
            ) : null}
          </CommandItem>
        </CommandGroup>

        {recentSessions.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent sessions">
              {recentSessions.map((session) => (
                <CommandItem
                  key={session.id}
                  value={`session-${session.id}-${session.title ?? ""}`}
                  keywords={[
                    session.title ?? "",
                    session.repoName ?? "",
                    session.repoOwner ?? "",
                  ]}
                  onSelect={() =>
                    runCommand(() => router.push(`/sessions/${session.id}`))
                  }
                >
                  <LayoutGrid />
                  <span className="truncate">
                    {session.title || "Untitled session"}
                  </span>
                  {session.repoName ? (
                    <CommandShortcut className="truncate">
                      {session.repoName}
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
