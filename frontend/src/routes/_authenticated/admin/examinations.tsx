import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  Calendar,
  Users,
  ClipboardList,
  BarChart3,
  Clock,
  MapPin,
  AlertCircle,
  CheckCircle2,
  Plus,
  Download,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/examinations")({
  ssr: false,
  component: AdminExaminationsPage,
});

function AdminExaminationsPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    { label: "Scheduled Exams", value: "0", icon: Calendar, color: "from-blue-500 to-blue-600" },
    { label: "Exam Centers", value: "0", icon: MapPin, color: "from-purple-500 to-purple-600" },
    { label: "Invigilators", value: "0", icon: Users, color: "from-green-500 to-green-600" },
    {
      label: "Completion Rate",
      value: "0%",
      icon: CheckCircle2,
      color: "from-emerald-500 to-emerald-600",
    },
  ];

  const exams = [
    { name: "Mid-Term Examinations", date: "Scheduled", students: 0, status: "Planning" },
    { name: "Final Year Exams", date: "Scheduled", students: 0, status: "Planning" },
  ];

  const examCenters = [
    { name: "Science Block", capacity: 0, assigned: 0, utilization: 0 },
    { name: "Arts Block", capacity: 0, assigned: 0, utilization: 0 },
  ];

  return (
    <PortalPage
      title="Examination Management System"
      subtitle="Advanced exam scheduling, seating arrangements, and invigilation coordination"
      actions={
        <>
          <Button disabled>Create Exam</Button>
          <Button variant="outline" disabled>
            Export Schedule
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="uos-card p-6 relative overflow-hidden">
                <div className={`absolute inset-0 bg-gradient-to-br ${stat.color} opacity-5`} />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-3">
                    <Icon className="h-6 w-6 text-primary opacity-60" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold">{stat.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tabs Section */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="scheduling">Scheduling</TabsTrigger>
            <TabsTrigger value="seating">Seating</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              {/* Active Exams */}
              <div className="uos-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Scheduled Examinations
                  </h3>
                  <Button size="sm" variant="outline">
                    <Plus className="h-4 w-4 mr-1" />
                    New
                  </Button>
                </div>
                <div className="space-y-4">
                  {exams.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No exams scheduled yet. Click "New" to create one.
                    </p>
                  ) : (
                    exams.map((exam, i) => (
                      <div
                        key={i}
                        className="p-4 border border-border rounded-lg hover:bg-accent/50 transition"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-medium text-sm">{exam.name}</p>
                            <p className="text-xs text-muted-foreground mt-1">{exam.date}</p>
                          </div>
                          <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                            {exam.status}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Exam Centers Utilization */}
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <MapPin className="h-5 w-5" />
                  Exam Centers & Capacity
                </h3>
                <div className="space-y-4">
                  {examCenters.map((center, i) => (
                    <div key={i} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{center.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {center.assigned}/{center.capacity} capacity
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
                          style={{ width: `${center.utilization}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Invigilation Summary */}
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <Users className="h-5 w-5" />
                Invigilation Management
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Invigilators Available</p>
                  <p className="text-2xl font-bold">0</p>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Assigned</p>
                  <p className="text-2xl font-bold">0</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <p className="text-sm text-muted-foreground mb-1">Availability Rate</p>
                  <p className="text-2xl font-bold">0%</p>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Scheduling Tab */}
          <TabsContent value="scheduling" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Exam Timetable & Scheduling
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Schedule Exam
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-4 font-medium">Exam Name</th>
                        <th className="text-left py-3 px-4 font-medium">Date</th>
                        <th className="text-left py-3 px-4 font-medium">Time</th>
                        <th className="text-left py-3 px-4 font-medium">Duration</th>
                        <th className="text-left py-3 px-4 font-medium">Subject</th>
                        <th className="text-right py-3 px-4 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-border hover:bg-accent/50">
                        <td colSpan={6} className="text-center py-8 text-muted-foreground">
                          No exams scheduled. Create one to get started.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Seating Tab */}
          <TabsContent value="seating" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Seating Arrangements
                </h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Generate Arrangement
                </Button>
              </div>

              <div className="space-y-4">
                <div className="p-6 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="h-5 w-5 text-blue-600 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-blue-900">
                        Automatic Seating Generation
                      </p>
                      <p className="text-sm text-blue-700 mt-1">
                        Generate optimal seating arrangements based on exam center capacity, student
                        enrollment, and invigilation requirements. Our AI ensures fair distribution
                        and accessibility.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  <div className="p-4 border border-border rounded-lg">
                    <p className="text-sm font-medium mb-3">Seating Configuration</p>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>• Conflict-free seating</p>
                      <p>• Accessibility considerations</p>
                      <p>• Special needs accommodation</p>
                      <p>• Print-ready arrangements</p>
                    </div>
                  </div>
                  <div className="p-4 border border-border rounded-lg">
                    <p className="text-sm font-medium mb-3">Advanced Features</p>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>• Alphabetical/random distribution</p>
                      <p>• Stream separation</p>
                      <p>• Real-time verification</p>
                      <p>• Student seat cards</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <BarChart3 className="h-5 w-5" />
                  Exam Performance Metrics
                </h3>
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Average Performance</p>
                    <p className="text-3xl font-bold">—</p>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Performance Variance</p>
                    <p className="text-3xl font-bold">—</p>
                  </div>
                  <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Top Performer Average</p>
                    <p className="text-3xl font-bold">—</p>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <AlertCircle className="h-5 w-5" />
                  Risk Analysis & Alerts
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="font-medium text-yellow-900">⚠ No exams scheduled</p>
                  </div>
                  <div className="p-3 border border-border rounded-lg">
                    <p className="text-muted-foreground">
                      Predictive alerts will appear when exams are scheduled
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
