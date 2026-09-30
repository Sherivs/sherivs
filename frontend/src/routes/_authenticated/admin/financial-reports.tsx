import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart,
  Download,
  Filter,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/financial-reports")({
  ssr: false,
  component: AdminFinancialReportsPage,
});

function AdminFinancialReportsPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    { label: "Total Revenue", value: "₦0", icon: DollarSign, color: "from-green-500 to-green-600" },
    { label: "Total Expenses", value: "₦0", icon: TrendingUp, color: "from-red-500 to-red-600" },
    { label: "Net Position", value: "₦0", icon: BarChart3, color: "from-blue-500 to-blue-600" },
    {
      label: "Cash Flow Health",
      value: "—",
      icon: PieChart,
      color: "from-purple-500 to-purple-600",
    },
  ];

  return (
    <PortalPage
      title="Financial Analytics & Reporting"
      subtitle="Revenue analysis, expense tracking, cash-flow management, and financial forecasting"
      actions={
        <>
          <Button disabled>Generate Report</Button>
          <Button variant="outline" disabled>
            Export Data
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
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="expenses">Expenses</TabsTrigger>
            <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
            <TabsTrigger value="forecast">Forecast</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <ArrowUpRight className="h-5 w-5 text-green-600" />
                  Revenue Summary
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Total Income</p>
                    <p className="text-3xl font-bold">₦0</p>
                    <p className="text-xs text-muted-foreground mt-2">Year to date</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <p className="text-muted-foreground">Fees</p>
                      <p className="font-bold text-lg">₦0</p>
                    </div>
                    <div className="p-3 bg-purple-50 rounded-lg">
                      <p className="text-muted-foreground">Grants</p>
                      <p className="font-bold text-lg">₦0</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <ArrowDownLeft className="h-5 w-5 text-red-600" />
                  Expense Summary
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-red-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Total Expenses</p>
                    <p className="text-3xl font-bold">₦0</p>
                    <p className="text-xs text-muted-foreground mt-2">Year to date</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="p-3 bg-orange-50 rounded-lg">
                      <p className="text-muted-foreground">Salaries</p>
                      <p className="font-bold text-lg">₦0</p>
                    </div>
                    <div className="p-3 bg-yellow-50 rounded-lg">
                      <p className="text-muted-foreground">Operations</p>
                      <p className="font-bold text-lg">₦0</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="revenue" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Revenue Analysis
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
              <div className="text-center py-12">
                <DollarSign className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">Revenue data will display here</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="expenses" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Expense Breakdown
                </h3>
                <Button size="sm">
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>
              </div>
              <div className="grid lg:grid-cols-3 gap-4">
                {["Salaries", "Infrastructure", "Utilities"].map((category) => (
                  <div key={category} className="p-4 border border-border rounded-lg">
                    <p className="text-sm font-medium mb-2">{category}</p>
                    <p className="text-2xl font-bold">₦0</p>
                    <p className="text-xs text-muted-foreground mt-2">0% of budget</p>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="cashflow" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-6">
                <TrendingUp className="h-5 w-5" />
                Cash Flow Management
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <div className="flex items-start gap-4">
                    <AlertCircle className="h-5 w-5 text-blue-600 mt-1 flex-shrink-0" />
                    <div>
                      <p className="font-medium text-sm text-blue-900">
                        Real-time Cash Flow Monitoring
                      </p>
                      <p className="text-sm text-blue-700 mt-1">
                        Track inflows, outflows, and predict future cash position with AI-powered
                        forecasting
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="forecast" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-6">
                <BarChart3 className="h-5 w-5" />
                Financial Forecasting
              </h3>
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-lg">
                  <p className="text-sm font-medium mb-2">Projected Revenue</p>
                  <p className="text-2xl font-bold">₦0</p>
                  <p className="text-xs text-muted-foreground mt-2">Next 12 months</p>
                </div>
                <div className="p-4 bg-gradient-to-br from-red-50 to-red-100 rounded-lg">
                  <p className="text-sm font-medium mb-2">Projected Expenses</p>
                  <p className="text-2xl font-bold">₦0</p>
                  <p className="text-xs text-muted-foreground mt-2">Next 12 months</p>
                </div>
                <div className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg">
                  <p className="text-sm font-medium mb-2">Projected Surplus</p>
                  <p className="text-2xl font-bold">₦0</p>
                  <p className="text-xs text-muted-foreground mt-2">Net position</p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
