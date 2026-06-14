import type { Metadata } from "next";
import { ScheduledTasksSection } from "../scheduled-tasks-section";

export const metadata: Metadata = {
  title: "Scheduled tasks",
  description: "Schedule prompts to run automatically on a schedule.",
};

export default function ScheduledTasksPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Scheduled tasks</h1>
      </div>
      <ScheduledTasksSection />
    </div>
  );
}
