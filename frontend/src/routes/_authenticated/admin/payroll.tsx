import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  Users,
  DollarSign,
  FileText,
  BarChart3,
  TrendingUp,
  Plus,
  Download,
  Filter,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/payroll")({
  ssr: false,
  component: AdminPayrollPage,
});

function AdminPayrollPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    { label: "Staff Members", value: "0", icon: Users, color: "from-blue-500 to-blue-600" },
    {
      label: "Monthly Payroll",
      value: "₦0",
      icon: DollarSign,
      color: "from-green-500 to-green-600",
    },
    {
      label: "Payslips Generated",
      value: "0",
      icon: FileText,
      color: "from-purple-500 to-purple-600",
    },
    {
      label: "Compliance Status",
      value: "Good",
      icon: CheckCircle2,
      color: "from-emerald-500 to-emerald-600",
    },
  ];

  return (
    <PortalPage
      title="Payroll Management System"
      subtitle="Salary administration, deductions, compliance, and comprehensive payroll analytics"
      actions={
        <>
          <Button disabled>Process Payroll</Button>
          <Button variant="outline" disabled>
            Generate Payslips
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
            <TabsTrigger value="payroll">Payroll Runs</TabsTrigger>
            <TabsTrigger value="staff">Staff</TabsTrigger>
            <TabsTrigger value="deductions">Deductions</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <DollarSign className="h-5 w-5" />
                  Payroll Summary
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Current Month Payroll</p>
                    <p className="text-3xl font-bold">₦0</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-green-50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Processed</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                    <div className="p-3 bg-yellow-50 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Pending</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <TrendingUp className="h-5 w-5" />
                  Deductions & Benefits
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <p className="text-muted-foreground mb-1">Total Deductions</p>
                    <p className="text-2xl font-bold">₦0</p>
                  </div>
                  <div className="p-3 bg-indigo-50 rounded-lg">
                    <p className="text-muted-foreground mb-1">Benefits Accrued</p>
                    <p className="text-2xl font-bold">₦0</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <AlertCircle className="h-5 w-5" />
                System Status
              </h3>
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <p className="font-medium text-sm text-green-900">
                  ✓ Payroll system is compliant and up-to-date
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="payroll" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Payroll Runs
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New Run
                  </Button>
                </div>
              </div>
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No payroll runs created yet</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="staff" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Staff Salary Configuration
                </h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Add Staff
                </Button>
              </div>
              <div className="text-center py-12">
                <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No staff members configured</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="deductions" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-6">
                <BarChart3 className="h-5 w-5" />
                Deductions & Tax Management
              </h3>
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Tax Deductions</p>
                  <p className="text-2xl font-bold">₦0</p>
                </div>
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Statutory Deductions</p>
                  <p className="text-2xl font-bold">₦0</p>
                </div>
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Voluntary Deductions</p>
                  <p className="text-2xl font-bold">₦0</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="reports" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Payroll Reports
                </h3>
                <Button size="sm">
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
              </div>
              <div className="space-y-2">
                {["Payslip Summary", "Tax Report", "Deductions Report", "Year-End Summary"].map(
                  (report) => (
                    <div
                      key={report}
                      className="p-3 border border-border rounded-lg hover:bg-accent/50 flex items-center justify-between"
                    >
                      <span className="text-sm font-medium">{report}</span>
                      <Download className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ),
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
