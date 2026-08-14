import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { NavigationProgress } from "@/components/navigation-progress";
import { createAdminClient } from "@/lib/supabase";
import { getProjects } from "@/lib/projects";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const projects = await getProjects(createAdminClient());
  return (
    <div className="flex h-screen overflow-hidden">
      <Suspense fallback={null}>
        <NavigationProgress />
      </Suspense>
      <Sidebar projects={projects} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
