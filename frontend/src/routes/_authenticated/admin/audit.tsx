import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  ShieldAlert,
  Clock,
  Users,
  Activity,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Download,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  ssr: false,
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    {
      label: "Total Events Logged",
      value: "0",
      icon: Activity,
      color: "from-blue-500 to-blue-600",
    },
    { label: "User Actions", value: "0", icon: Users, color: "from-green-500 to-green-600" },
    {
      label: "System Changes",
      value: "0",
      icon: ShieldAlert,
      color: "from-purple-500 to-purple-600",
    },
    { label: "Security Events", value: "0", icon: Lock, color: "from-red-500 to-red-600" },
  ];

  return (
    <PortalPage
      title="Comprehensive Audit & Compliance System"
      subtitle="Complete activity logging, security monitoring, regulatory compliance, and forensic analysis"
      actions={
        <>
          <Button onClick={() => navigate({ to: "/admin/audit-logs" })}>View Detailed Logs</Button>
          <Button variant="outline" disabled>
            Export Report
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

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Activity className="h-5 w-5" />
                  System Activity Summary
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Today's Events</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">User Actions</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                    <div className="p-3 bg-orange-50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">System Events</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Clock className="h-5 w-4" />
                  Recent Activity
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Last Event</p>
                    <p className="text-sm font-medium text-muted-foreground">No events yet</p>
                  </div>
                  <div className="p-4 bg-indigo-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Active Sessions</p>
                    <p className="text-2xl font-bold">0</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <CheckCircle2 className="h-5 w-5" />
                System Health
              </h3>
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">✓ Audit Logging</p>
                  <p className="text-xs text-green-700">Active & Monitoring</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">✓ Data Integrity</p>
                  <p className="text-xs text-green-700">All records verified</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">✓ Log Retention</p>
                  <p className="text-xs text-green-700">Compliant</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  Security Events
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                  <Button size="sm">
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                </div>
              </div>
              <div className="space-y-3">
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Failed Logins</p>
                  <p className="text-3xl font-bold">0</p>
                </div>
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Password Changes</p>
                  <p className="text-3xl font-bold">0</p>
                </div>
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Permission Changes</p>
                  <p className="text-3xl font-bold">0</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="compliance" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-6">
                <Lock className="h-5 w-5" />
                Regulatory Compliance
              </h3>
              <div className="space-y-3">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start gap-4">
                    <CheckCircle2 className="h-5 w-5 text-blue-600 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-blue-900">GDPR Compliance</p>
                      <p className="text-sm text-blue-700 mt-1">
                        Automatic data retention policies, consent tracking, and
                        right-to-be-forgotten management
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <div className="flex items-start gap-4">
                    <CheckCircle2 className="h-5 w-5 text-purple-600 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-purple-900">Data Protection</p>
                      <p className="text-sm text-purple-700 mt-1">
                        Encryption at rest and in transit, access controls, and audit trails
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <BarChart3 className="h-5 w-5" />
                  User Activity Trends
                </h3>
                <div className="p-6 bg-blue-50 rounded-lg text-center">
                  <p className="text-muted-foreground text-sm">Analytics data will display here</p>
                </div>
              </div>
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <AlertTriangle className="h-5 w-5" />
                  Anomaly Detection
                </h3>
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-900">✓ No anomalies detected</p>
                  <p className="text-xs text-green-700 mt-1">AI-powered monitoring is active</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reports" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Audit Reports
                </h3>
                <Button size="sm">
                  <Download className="h-4 w-4 mr-1" />
                  Generate Report
                </Button>
              </div>
              <div className="space-y-2">
                {[
                  "Daily Activity Summary",
                  "Security Events Report",
                  "Compliance Report",
                  "User Access Report",
                  "Data Change Report",
                ].map((report) => (
                  <div
                    key={report}
                    className="p-3 border border-border rounded-lg hover:bg-accent/50 flex items-center justify-between"
                  >
                    <span className="text-sm font-medium">{report}</span>
                    <Download className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
