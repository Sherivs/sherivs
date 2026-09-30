import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  ArrowLeftRight,
  Undo2,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/admin/library")({
  ssr: false,
  component: LibraryPage,
});

type Book = {
  id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  copies_total: number;
  copies_available: number;
  shelf_location: string | null;
  is_active: boolean;
};
type Borrowing = {
  id: string;
  book_id: string | null;
  student_id: string | null;
  borrowed_date: string;
  due_date: string | null;
  returned_date: string | null;
  status: string;
  fine_amount: number;
};

const FINE_PER_DAY = 100;

function LibraryPage() {
  const { profile } = useApp();
  const schoolId = profile?.school_id ?? "";
  const qc = useQueryClient();
  const [bookDlg, setBookDlg] = useState<{ open: boolean; book?: Book | null }>({ open: false });
  const [borrowOpen, setBorrowOpen] = useState(false);

  const booksQ = useQuery({
    queryKey: ["lib-books", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_books")
        .select("*")
        .eq("school_id", schoolId)
        .order("title")
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Book[];
    },
  });
  const borrowsQ = useQuery({
    queryKey: ["lib-borrows", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("library_borrowings")
        .select("*")
        .eq("school_id", schoolId)
        .order("borrowed_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Borrowing[];
    },
  });
  const studentNamesQ = useQuery({
    queryKey: ["lib-student-names", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data: students } = await supabase
        .from("students")
        .select("id, user_id, admission_number")
        .eq("school_id", schoolId);
      const ids = (students ?? []).map((s: any) => s.user_id).filter(Boolean);
      const map = new Map<string, string>();
      if (ids.length) {
        const { data: users } = await supabase.from("users").select("id, full_name").in("id", ids);
        const nameById = new Map((users ?? []).map((u: any) => [u.id, u.full_name as string]));
        (students ?? []).forEach((s: any) => map.set(s.id, nameById.get(s.user_id) ?? "Unnamed"));
      }
      return map;
    },
  });

  const books = booksQ.data ?? [];
  const borrows = borrowsQ.data ?? [];
  const active = borrows.filter((b) => b.status === "borrowed");
  const today = new Date().toISOString().slice(0, 10);
  const overdue = active.filter((b) => b.due_date && b.due_date < today);
  const totalBooks = books.reduce((a, b) => a + b.copies_total, 0);
  const availBooks = books.reduce((a, b) => a + b.copies_available, 0);
  const members = new Set(active.map((b) => b.student_id).filter(Boolean)).size;

  const popular = useMemo(() => {
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    borrows
      .filter((b) => b.borrowed_date >= cutoff)
      .forEach((b) => {
        if (b.book_id) counts.set(b.book_id, (counts.get(b.book_id) ?? 0) + 1);
      });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, n]) => ({ book: books.find((x) => x.id === id), count: n }));
  }, [borrows, books]);

  const delBook = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("library_books").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Book deleted");
      qc.invalidateQueries({ queryKey: ["lib-books"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const returnBook = useMutation({
    mutationFn: async (br: Borrowing) => {
      const daysLate =
        br.due_date && today > br.due_date
          ? Math.floor((Date.parse(today) - Date.parse(br.due_date)) / 86400_000)
          : 0;
      const fine = daysLate * FINE_PER_DAY;
      const { error } = await supabase
        .from("library_borrowings")
        .update({ status: "returned", returned_date: today, fine_amount: fine })
        .eq("id", br.id);
      if (error) throw error;
      if (br.book_id) {
        const book = books.find((b) => b.id === br.book_id);
        if (book) {
          await supabase
            .from("library_books")
            .update({ copies_available: Math.min(book.copies_total, book.copies_available + 1) })
            .eq("id", book.id);
        }
      }
    },
    onSuccess: () => {
      toast.success("Book returned");
      qc.invalidateQueries({ queryKey: ["lib-borrows"] });
      qc.invalidateQueries({ queryKey: ["lib-books"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (booksQ.isLoading) return <PortalPageSkeleton />;

  return (
    <PortalPage
      title="Library Management"
      subtitle="Book catalog, borrowings and overdue tracking"
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setBorrowOpen(true)}>
            <ArrowLeftRight className="mr-1.5 size-4" /> Borrow book
          </Button>
          <Button size="sm" onClick={() => setBookDlg({ open: true, book: null })}>
            <Plus className="mr-1.5 size-4" /> Add book
          </Button>
        </>
      }
    >
      <SectionGrid>
        <StatCard label="Total books" value={totalBooks} />
        <StatCard label="Available" value={availBooks} />
        <StatCard label="Borrowed" value={active.length} />
        <StatCard label="Overdue" value={overdue.length} />
        <StatCard label="Members" value={members} />
      </SectionGrid>

      <GlassCard>
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <BookOpen className="size-5 text-primary" /> Book catalog
        </h2>
        {books.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title="No books yet"
            description="Add books to your catalog to start lending."
          />
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="p-2">Title</th>
                  <th className="p-2">Author</th>
                  <th className="p-2">Category</th>
                  <th className="p-2">Shelf</th>
                  <th className="p-2">Avail/Total</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id} className="border-b border-border/50">
                    <td className="p-2 font-medium">
                      {b.title}
                      <div className="text-xs text-muted-foreground">{b.isbn ?? ""}</div>
                    </td>
                    <td className="p-2">{b.author ?? "—"}</td>
                    <td className="p-2">{b.category ?? "—"}</td>
                    <td className="p-2">{b.shelf_location ?? "—"}</td>
                    <td className="p-2">
                      {b.copies_available}/{b.copies_total}
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setBookDlg({ open: true, book: b })}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete ${b.title}?`)) delBook.mutate(b.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <GlassCard>
        <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
          <Undo2 className="size-5 text-primary" /> Active borrowings
        </h2>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active borrowings.</p>
        ) : (
          <div className="overflow-x-auto -mx-2">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="p-2">Student</th>
                  <th className="p-2">Book</th>
                  <th className="p-2">Borrowed</th>
                  <th className="p-2">Due</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {active.map((br) => {
                  const late = br.due_date && br.due_date < today;
                  return (
                    <tr key={br.id} className="border-b border-border/50">
                      <td className="p-2">
                        {br.student_id ? (studentNamesQ.data?.get(br.student_id) ?? "—") : "—"}
                      </td>
                      <td className="p-2">
                        {books.find((b) => b.id === br.book_id)?.title ?? "—"}
                      </td>
                      <td className="p-2">{br.borrowed_date}</td>
                      <td className="p-2">{br.due_date ?? "—"}</td>
                      <td className={"p-2 " + (late ? "text-red-400" : "")}>
                        {late ? "Overdue" : "Borrowed"}
                      </td>
                      <td className="p-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => returnBook.mutate(br)}>
                          Mark returned
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

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="size-5 text-red-400" /> Overdue
          </h2>
          {overdue.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing overdue.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {overdue.map((br) => {
                const days = Math.floor((Date.parse(today) - Date.parse(br.due_date!)) / 86400_000);
                return (
                  <li key={br.id} className="py-2 flex justify-between">
                    <span>
                      {br.student_id ? (studentNamesQ.data?.get(br.student_id) ?? "—") : "—"} ·{" "}
                      {books.find((b) => b.id === br.book_id)?.title ?? "—"}
                    </span>
                    <span className="text-red-400">
                      {days}d · ₦{(days * FINE_PER_DAY).toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </GlassCard>
        <GlassCard>
          <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
            <TrendingUp className="size-5 text-primary" /> Popular (30d)
          </h2>
          {popular.length === 0 ? (
            <p className="text-sm text-muted-foreground">No borrowings in the last 30 days.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {popular.map((p, i) => (
                <li key={i} className="py-2 flex justify-between">
                  <span>{p.book?.title ?? "—"}</span>
                  <span className="text-muted-foreground">{p.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      {bookDlg.open && (
        <BookDialog
          schoolId={schoolId}
          book={bookDlg.book ?? null}
          onClose={() => setBookDlg({ open: false })}
          onSaved={() => {
            setBookDlg({ open: false });
            qc.invalidateQueries({ queryKey: ["lib-books"] });
          }}
        />
      )}
      {borrowOpen && (
        <BorrowDialog
          schoolId={schoolId}
          books={books.filter((b) => b.copies_available > 0)}
          onClose={() => setBorrowOpen(false)}
          onSaved={() => {
            setBorrowOpen(false);
            qc.invalidateQueries({ queryKey: ["lib-borrows"] });
            qc.invalidateQueries({ queryKey: ["lib-books"] });
          }}
        />
      )}
    </PortalPage>
  );
}

function BookDialog({
  schoolId,
  book,
  onClose,
  onSaved,
}: {
  schoolId: string;
  book: Book | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: book?.title ?? "",
    author: book?.author ?? "",
    isbn: book?.isbn ?? "",
    category: book?.category ?? "",
    copies_total: book?.copies_total ?? 1,
    copies_available: book?.copies_available ?? 1,
    shelf_location: book?.shelf_location ?? "",
  });
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        school_id: schoolId,
        copies_total: Number(form.copies_total),
        copies_available: Number(form.copies_available),
      };
      if (book?.id) {
        const { error } = await supabase.from("library_books").update(payload).eq("id", book.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("library_books").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(book ? "Book updated" : "Book added");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{book ? "Edit book" : "Add book"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div>
            <Label>Author</Label>
            <Input
              value={form.author ?? ""}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
            />
          </div>
          <div>
            <Label>ISBN</Label>
            <Input
              value={form.isbn ?? ""}
              onChange={(e) => setForm({ ...form, isbn: e.target.value })}
            />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              value={form.category ?? ""}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </div>
          <div>
            <Label>Shelf</Label>
            <Input
              value={form.shelf_location ?? ""}
              onChange={(e) => setForm({ ...form, shelf_location: e.target.value })}
            />
          </div>
          <div>
            <Label>Total copies</Label>
            <Input
              type="number"
              min={1}
              value={form.copies_total}
              onChange={(e) => setForm({ ...form, copies_total: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label>Available</Label>
            <Input
              type="number"
              min={0}
              value={form.copies_available}
              onChange={(e) => setForm({ ...form, copies_available: Number(e.target.value) })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!form.title || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BorrowDialog({
  schoolId,
  books,
  onClose,
  onSaved,
}: {
  schoolId: string;
  books: Book[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    student_id: "",
    book_id: "",
    due_date: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
  });
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("library_borrowings").insert({
        school_id: schoolId,
        student_id: form.student_id,
        book_id: form.book_id,
        borrowed_date: new Date().toISOString().slice(0, 10),
        due_date: form.due_date,
        status: "borrowed",
      });
      if (error) throw error;
      const book = books.find((b) => b.id === form.book_id);
      if (book)
        await supabase
          .from("library_books")
          .update({ copies_available: Math.max(0, book.copies_available - 1) })
          .eq("id", book.id);
    },
    onSuccess: () => {
      toast.success("Book issued");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Borrow book</DialogTitle>
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
            <Label>Book</Label>
            <Select value={form.book_id} onValueChange={(v) => setForm({ ...form, book_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select book" />
              </SelectTrigger>
              <SelectContent>
                {books.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.title} ({b.copies_available} avail)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Due date</Label>
            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!form.student_id || !form.book_id || save.isPending}
          >
            {save.isPending ? "Saving…" : "Issue book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
