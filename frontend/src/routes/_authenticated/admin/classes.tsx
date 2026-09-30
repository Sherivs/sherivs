import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ChevronDown, Users, BookOpen, Settings, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, GlassCard } from "@/components/portal-shell";
import { CLASS_LEVELS, SECTIONS, className as buildName } from "@/lib/class-levels";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/classes")({
  ssr: false,
  component: ClassesPage,
});

type ClassRow = { id: string; name: string; grade_level: string | null };

function ClassesPage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const qc = useQueryClient();
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["admin-classes", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, grade_level")
        .eq("school_id", schoolId!)
        .order("name");
      if (error) throw error;
      return (data ?? []) as ClassRow[];
    },
  });

  const selectedClass = useMemo(() => {
    return q.data?.find((c) => c.id === selectedClassId);
  }, [q.data, selectedClassId]);

  const addClass = useMutation({
    mutationFn: async ({ level, section }: { level: string; section: string | null }) => {
      if (!schoolId) throw new Error("No school selected");
      const name = buildName(level, section);
      const { data, error } = await supabase
        .from("classes")
        .insert({ school_id: schoolId, name, grade_level: level })
        .select("id, name, grade_level")
        .single();
      if (error) throw error;
      return data as ClassRow;
    },
    onSuccess: (newClass) => {
      toast.success(`${newClass.name} added`);
      void qc.invalidateQueries({ queryKey: ["admin-classes", schoolId] });
      setSelectedClassId(newClass.id);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusy(null),
  });

  const deleteClass = useMutation({
    mutationFn: async (classId: string) => {
      const { error } = await supabase.from("classes").delete().eq("id", classId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Class deleted");
      void qc.invalidateQueries({ queryKey: ["admin-classes", schoolId] });
      setSelectedClassId(null);
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusy(null),
  });

  const activeCount = q.data?.length ?? 0;
  const isLoading = q.isLoading;

  return (
    <PortalPage
      title="Classes Management"
      subtitle="Select a class to manage, or create new classes for your school"
    >
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            to="/admin/dashboard"
            className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-accent"
          >
            â† Back to dashboard
          </Link>
          <span className="text-muted-foreground">
            {activeCount} class{activeCount === 1 ? "" : "es"} active
          </span>
        </div>

        {/* Class Selector Dropdown */}
        <div className="uos-card p-6">
          <label className="text-sm font-semibold mb-3 block">Select Class</label>
          <div className="relative">
            <select
              value={selectedClassId || ""}
              onChange={(e) => setSelectedClassId(e.target.value || null)}
              disabled={isLoading}
              className="w-full px-4 py-2.5 rounded-lg border border-border bg-background appearance-none cursor-pointer hover:bg-accent/50 transition-colors pr-10"
            >
              <option value="">-- Choose a class --</option>
              {q.data?.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>

      {selectedClass && (
        <div className="space-y-6">
          {/* Class Details Card */}
          <GlassCard>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">{selectedClass.name}</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedClass.grade_level} Grade
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  if (confirm(`Delete class ${selectedClass.name}?`)) {
                    setBusy(selectedClass.id);
                    deleteClass.mutate(selectedClass.id);
                  }
                }}
                disabled={deleteClass.isPending}
              >
                {deleteClass.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete
              </Button>
            </div>

            <div className="grid lg:grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  <p className="text-sm font-medium text-muted-foreground">Students</p>
                </div>
                <p className="text-3xl font-bold">0</p>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="h-5 w-5 text-purple-600" />
                  <p className="text-sm font-medium text-muted-foreground">Subjects</p>
                </div>
                <p className="text-3xl font-bold">0</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="h-5 w-5 text-green-600" />
                  <p className="text-sm font-medium text-muted-foreground">Teachers</p>
                </div>
                <p className="text-3xl font-bold">0</p>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="h-5 w-5 text-orange-600" />
                  <p className="text-sm font-medium text-muted-foreground">Status</p>
                </div>
                <p className="text-lg font-bold">Active</p>
              </div>
            </div>
          </GlassCard>

          {/* Class Sections Tab */}
          <GlassCard>
            <h3 className="text-lg font-semibold mb-4">Manage Sections</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Classes can have multiple sections (A, B, C, etc.). Select sections to create
              sub-classes.
            </p>
            <div className="grid gap-4">
              <div className="flex flex-wrap gap-2">
                {SECTIONS.map((section) => {
                  const sectionName = buildName(
                    selectedClass.grade_level || selectedClass.name,
                    section,
                  );
                  const exists = q.data?.some((c) => c.name === sectionName);
                  return (
                    <Button
                      key={section}
                      variant={exists ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        if (!exists) {
                          setBusy(section);
                          addClass.mutate({
                            level: selectedClass.grade_level || selectedClass.name,
                            section,
                          });
                        }
                      }}
                      disabled={addClass.isPending}
                    >
                      {section}
                    </Button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Click on a letter to create a section (e.g., Class A, Class B)
              </p>
            </div>
          </GlassCard>

          {/* Class Settings */}
          <GlassCard>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Class Settings
            </h3>
            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium mb-2 block">Class Name</label>
                <input
                  type="text"
                  value={selectedClass.name}
                  disabled
                  className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-muted-foreground"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Grade Level</label>
                <input
                  type="text"
                  value={selectedClass.grade_level || "N/A"}
                  disabled
                  className="w-full px-3 py-2 rounded-lg border border-border bg-muted text-muted-foreground"
                />
              </div>
            </div>
          </GlassCard>

          {/* Quick Actions */}
          <GlassCard>
            <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
            <div className="grid sm:grid-cols-3 gap-3">
              <Button className="w-full" variant="outline">
                <Users className="h-4 w-4 mr-2" />
                View Students
              </Button>
              <Button className="w-full" variant="outline">
                <BookOpen className="h-4 w-4 mr-2" />
                Manage Subjects
              </Button>
              <Button className="w-full" variant="outline">
                <Users className="h-4 w-4 mr-2" />
                Assign Teachers
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      {!selectedClass && (
        <div className="text-center py-12">
          <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-30" />
          <p className="text-muted-foreground mb-6">
            Select a class from the dropdown to get started
          </p>
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">Or create a new class:</h3>
            <div className="grid sm:grid-cols-2 gap-3 max-w-2xl mx-auto">
              {CLASS_LEVELS.map((group) => (
                <div key={group.group} className="border border-border rounded-lg p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-3">{group.group}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.levels.map((level) => (
                      <Button
                        key={level}
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setBusy(level);
                          addClass.mutate({ level, section: null });
                        }}
                        disabled={addClass.isPending}
                      >
                        {busy === level && addClass.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="h-3 w-3 mr-1" />
                        )}
                        {level}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </PortalPage>
  );
}
