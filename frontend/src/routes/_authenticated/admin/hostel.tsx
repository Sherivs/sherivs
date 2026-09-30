import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, BedDouble, UserPlus, ClipboardCheck, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  GlassCard,
  StatCard,
  SectionGrid,
  PortalPageSkeleton,
  EmptyState,
} from "@/components/portal-shell";
import { StudentSelect } from "@/components/admin/student-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/hostel")({
  ssr: false,
  component: HostelPage,
});

type Room = {
  id: string;
  room_name: string;
  block: string | null;
  floor: string | null;
  capacity: number;
  gender: string | null;
  is_active: boolean;
};
type Allocation = {
  id: string;
  room_id: string | null;
  student_id: string | null;
  bed_number: number | null;
  session: string | null;
  term: string | null;
  is_active: boolean;
};
type Attendance = {
  student_id: string | null;
  night_check: string | null;
  morning_check: string | null;
};

const CHECK_OPTS = ["present", "absent", "leave", "clinic"] as const;

function HostelPage() {
  const { profile } = useApp();
  const schoolId = profile?.school_id ?? "";
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ open: boolean; room?: Room | null }>({ open: false });
  const [allocOpen, setAllocOpen] = useState(false);
  const [attRoomId, setAttRoomId] = useState<string>("");
  const [attDate, setAttDate] = useState(() => new Date().toISOString().slice(0, 10));

  const roomsQ = useQuery({
    queryKey: ["hostel-rooms", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hostel_rooms")
        .select("*")
        .eq("school_id", schoolId)
        .order("room_name")
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Room[];
    },
  });

  const allocsQ = useQuery({
    queryKey: ["hostel-allocations", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hostel_allocations")
        .select("*")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Allocation[];
    },
  });

  const studentNamesQ = useQuery({
    queryKey: ["hostel-student-names", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id, admission_number")
        .eq("school_id", schoolId);
      const ids = (students ?? []).map((s: any) => s.user_id).filter(Boolean);
      const map = new Map<string, { name: string; adm: string | null }>();
      if (ids.length) {
        const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids);
        const nameById = new Map((users ?? []).map((u: any) => [u.id, u.full_name as string]));
        (students ?? []).forEach((s: any) => {
          map.set(s.id, {
            name: nameById.get(s.user_id) ?? "Unnamed",
            adm: s.admission_number ?? null,
          });
        });
      }
      return map;
    },
  });

  const rooms = roomsQ.data ?? [];
  const allocs = allocsQ.data ?? [];
  const totalBeds = rooms.reduce((a, r) => a + (r.capacity || 0), 0);
  const occupied = allocs.length;
  const available = Math.max(0, totalBeds - occupied);
  const occRate = totalBeds > 0 ? Math.round((occupied / totalBeds) * 100) : 0;
  const occByRoom = useMemo(() => {
    const m = new Map<string, number>();
    allocs.forEach((a) => {
      if (a.room_id) m.set(a.room_id, (m.get(a.room_id) ?? 0) + 1);
    });
    return m;
  }, [allocs]);

  const deleteRoom = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hostel_rooms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Room deleted");
      qc.invalidateQueries({ queryKey: ["hostel-rooms"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (roomsQ.isLoading) return <PortalPageSkeleton />;

  return (
    <PortalPage
      title="Hostel Management"
      subtitle="Residential life management and boarding student welfare"
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setAllocOpen(true)}>
            <UserPlus className="mr-1.5 size-4" /> Allocate student
          </Button>
          <Button size="sm" onClick={() => setDialog({ open: true, room: null })}>
            <Plus className="mr-1.5 size-4" /> Add room
          </Button>
        </>
      }
    >
      <SectionGrid>
        <StatCard label="Total rooms" value={rooms.length} />
        <StatCard label="Total beds" value={totalBeds} />
        <StatCard label="Occupied" value={occupied} />
        <StatCard label="Available" value={available} />
        <StatCard label="Occupancy" value={`${occRate}%`} />
      </SectionGrid>

      <GlassCard>
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <Building2 className="size-5 text-primary" /> Rooms
        </h2>
        {rooms.length === 0 ? (
          <EmptyState
            icon={<BedDouble className="size-6" />}
            title="No rooms yet"
            description="Add your first hostel room to start assigning students."
          />
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="p-2">Room</th>
                  <th className="p-2">Block</th>
                  <th className="p-2">Capacity</th>
                  <th className="p-2">Occupied</th>
                  <th className="p-2">Available</th>
                  <th className="p-2">Gender</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => {
                  const occ = occByRoom.get(r.id) ?? 0;
                  const avail = Math.max(0, r.capacity - occ);
                  return (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="p-2 font-medium">{r.room_name}</td>
                      <td className="p-2">
                        {r.block ?? "—"}
                        {r.floor ? ` · F${r.floor}` : ""}
                      </td>
                      <td className="p-2">{r.capacity}</td>
                      <td className="p-2">{occ}</td>
                      <td className="p-2">{avail}</td>
                      <td className="p-2 capitalize">{r.gender ?? "—"}</td>
                      <td className="p-2">{r.is_active ? "Active" : "Inactive"}</td>
                      <td className="p-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDialog({ open: true, room: r })}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(`Delete room ${r.room_name}?`)) deleteRoom.mutate(r.id);
                          }}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="font-display text-lg font-semibold mb-3">Occupancy dashboard</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {rooms.map((r) => {
            const occ = occByRoom.get(r.id) ?? 0;
            const full = occ >= r.capacity;
            const color = full
              ? "bg-red-500/15 border-red-500/40 text-red-400"
              : occ > 0
                ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
                : "bg-green-500/15 border-green-500/40 text-green-400";
            return (
              <div key={r.id} className={cn("rounded-xl border p-3 text-center", color)}>
                <div className="font-semibold">{r.room_name}</div>
                <div className="text-xs mt-1">
                  {occ}/{r.capacity} beds
                </div>
                <div className="text-[10px] uppercase tracking-wider mt-1 opacity-70">
                  {full ? "Full" : occ > 0 ? "Occupied" : "Available"}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      <NightAttendance
        schoolId={schoolId}
        rooms={rooms}
        allocs={allocs}
        studentNames={studentNamesQ.data ?? new Map()}
        recordedBy={profile?.id ?? ""}
        attRoomId={attRoomId}
        setAttRoomId={setAttRoomId}
        attDate={attDate}
        setAttDate={setAttDate}
      />

      {dialog.open && (
        <RoomDialog
          schoolId={schoolId}
          room={dialog.room ?? null}
          onClose={() => setDialog({ open: false })}
          onSaved={() => {
            setDialog({ open: false });
            qc.invalidateQueries({ queryKey: ["hostel-rooms"] });
          }}
        />
      )}
      {allocOpen && (
        <AllocationDialog
          schoolId={schoolId}
          rooms={rooms}
          onClose={() => setAllocOpen(false)}
          onSaved={() => {
            setAllocOpen(false);
            qc.invalidateQueries({ queryKey: ["hostel-allocations"] });
          }}
        />
      )}
    </PortalPage>
  );
}

function RoomDialog({
  schoolId,
  room,
  onClose,
  onSaved,
}: {
  schoolId: string;
  room: Room | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    room_name: room?.room_name ?? "",
    block: room?.block ?? "",
    floor: room?.floor ?? "",
    capacity: room?.capacity ?? 4,
    gender: room?.gender ?? "mixed",
    is_active: room?.is_active ?? true,
  });
  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, school_id: schoolId, capacity: Number(form.capacity) || 1 };
      if (room?.id) {
        const { error } = await supabase.from("hostel_rooms").update(payload).eq("id", room.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hostel_rooms").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(room ? "Room updated" : "Room added");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "Add room"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Room name</Label>
            <Input
              value={form.room_name}
              onChange={(e) => setForm({ ...form, room_name: e.target.value })}
            />
          </div>
          <div>
            <Label>Block</Label>
            <Input
              value={form.block ?? ""}
              onChange={(e) => setForm({ ...form, block: e.target.value })}
            />
          </div>
          <div>
            <Label>Floor</Label>
            <Input
              value={form.floor ?? ""}
              onChange={(e) => setForm({ ...form, floor: e.target.value })}
            />
          </div>
          <div>
            <Label>Capacity</Label>
            <Input
              type="number"
              min={1}
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Gender</Label>
            <Select
              value={form.gender ?? "mixed"}
              onValueChange={(v) => setForm({ ...form, gender: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="mixed">Mixed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!form.room_name || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllocationDialog({
  schoolId,
  rooms,
  onClose,
  onSaved,
}: {
  schoolId: string;
  rooms: Room[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    student_id: "",
    room_id: "",
    bed_number: 1,
    session: "",
    term: "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("hostel_allocations").insert({
        ...form,
        school_id: schoolId,
        bed_number: Number(form.bed_number) || null,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Student allocated");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Allocate student to room</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Student</Label>
            <StudentSelect
              value={form.student_id}
              onChange={(id) => setForm({ ...form, student_id: id })}
            />
          </div>
          <div>
            <Label>Room</Label>
            <Select value={form.room_id} onValueChange={(v) => setForm({ ...form, room_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select room" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.room_name} ({r.capacity} beds)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Bed #</Label>
              <Input
                type="number"
                min={1}
                value={form.bed_number}
                onChange={(e) => setForm({ ...form, bed_number: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>Session</Label>
              <Input
                placeholder="2025/26"
                value={form.session}
                onChange={(e) => setForm({ ...form, session: e.target.value })}
              />
            </div>
            <div>
              <Label>Term</Label>
              <Input
                placeholder="1st"
                value={form.term}
                onChange={(e) => setForm({ ...form, term: e.target.value })}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.student_id || !form.room_id || save.isPending}
          >
            {save.isPending ? "Saving…" : "Allocate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NightAttendance({
  schoolId,
  rooms,
  allocs,
  studentNames,
  recordedBy,
  attRoomId,
  setAttRoomId,
  attDate,
  setAttDate,
}: {
  schoolId: string;
  rooms: Room[];
  allocs: Allocation[];
  studentNames: Map<string, { name: string; adm: string | null }>;
  recordedBy: string;
  attRoomId: string;
  setAttRoomId: (v: string) => void;
  attDate: string;
  setAttDate: (v: string) => void;
}) {
  const qc = useQueryClient();
  const existingQ = useQuery({
    queryKey: ["hostel-att", schoolId, attRoomId, attDate],
    enabled: !!schoolId && !!attRoomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hostel_attendance")
        .select("student_id, night_check, morning_check")
        .eq("school_id", schoolId)
        .eq("room_id", attRoomId)
        .eq("date", attDate);
      if (error) throw error;
      return (data ?? []) as Attendance[];
    },
  });
  const [state, setState] = useState<Record<string, { night?: string; morning?: string }>>({});
  const roomStudents = allocs.filter((a) => a.room_id === attRoomId);

  const existingMap = useMemo(() => {
    const m = new Map<string, Attendance>();
    (existingQ.data ?? []).forEach((r) => {
      if (r.student_id) m.set(r.student_id, r);
    });
    return m;
  }, [existingQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(state)
        .map(([sid, v]) => ({
          school_id: schoolId,
          room_id: attRoomId,
          student_id: sid,
          date: attDate,
          night_check: v.night ?? null,
          morning_check: v.morning ?? null,
          recorded_by: recordedBy || null,
        }))
        .filter((r) => r.night_check || r.morning_check);
      if (!rows.length) return;
      const { error } = await supabase.from("hostel_attendance").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Attendance saved");
      setState({});
      qc.invalidateQueries({ queryKey: ["hostel-att"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <GlassCard>
      <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
        <ClipboardCheck className="size-5 text-primary" /> Night & morning attendance
      </h2>
      <div className="flex flex-wrap gap-3 items-end mb-4">
        <div className="min-w-[200px]">
          <Label>Room</Label>
          <Select value={attRoomId} onValueChange={setAttRoomId}>
            <SelectTrigger>
              <SelectValue placeholder="Select room" />
            </SelectTrigger>
            <SelectContent>
              {rooms.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.room_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Date</Label>
          <Input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} />
        </div>
        <Button
          onClick={() => save.mutate()}
          disabled={!attRoomId || save.isPending || Object.keys(state).length === 0}
        >
          {save.isPending ? "Saving…" : "Save all"}
        </Button>
      </div>
      {!attRoomId ? (
        <p className="text-sm text-muted-foreground">Pick a room to mark attendance.</p>
      ) : roomStudents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No students allocated to this room.</p>
      ) : (
        <div className="space-y-2">
          {roomStudents.map((a) => {
            const s = a.student_id ? studentNames.get(a.student_id) : null;
            const existing = a.student_id ? existingMap.get(a.student_id) : null;
            const cur = a.student_id ? (state[a.student_id] ?? {}) : {};
            return (
              <div key={a.id} className="border border-border rounded-lg p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {s?.name ?? "Unnamed"}{" "}
                    <span className="text-muted-foreground">
                      · Bed {a.bed_number ?? "—"} · {s?.adm ?? ""}
                    </span>
                  </div>
                </div>
                {(["night", "morning"] as const).map((slot) => (
                  <div key={slot} className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase text-muted-foreground w-16">{slot}</span>
                    {CHECK_OPTS.map((o) => {
                      const active = (cur[slot] ?? existing?.[`${slot}_check` as const]) === o;
                      return (
                        <Button
                          key={o}
                          size="sm"
                          variant={active ? "default" : "outline"}
                          onClick={() =>
                            a.student_id &&
                            setState({ ...state, [a.student_id]: { ...cur, [slot]: o } })
                          }
                        >
                          {o}
                        </Button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
