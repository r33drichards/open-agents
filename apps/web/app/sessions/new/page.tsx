import { SessionCreateForm } from "@/components/session-create/session-create-form";
import { SidebarTrigger } from "@/components/ui/sidebar";

export default function NewSessionPage() {
  return (
    <>
      <header className="border-border border-b px-3 py-2 lg:px-4 lg:py-3">
        <div className="flex min-h-8 items-center gap-2">
          <SidebarTrigger className="shrink-0" />
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <SessionCreateForm />
      </div>
    </>
  );
}
