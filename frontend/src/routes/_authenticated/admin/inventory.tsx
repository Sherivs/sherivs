import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  Package,
  AlertCircle,
  Boxes,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  Plus,
  Filter,
  TrendingDown,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/inventory")({
  ssr: false,
  component: AdminInventoryPage,
});

function AdminInventoryPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    { label: "Total Assets", value: "0", icon: Boxes, color: "from-blue-500 to-blue-600" },
    { label: "Low Stock Alerts", value: "0", icon: AlertCircle, color: "from-red-500 to-red-600" },
    {
      label: "Equipment Status",
      value: "Good",
      icon: CheckCircle2,
      color: "from-green-500 to-green-600",
    },
    {
      label: "Requisitions Pending",
      value: "0",
      icon: Package,
      color: "from-purple-500 to-purple-600",
    },
  ];

  return (
    <PortalPage
      title="Inventory & Asset Management"
      subtitle="Real-time asset tracking, stock management, and equipment maintenance"
      actions={
        <>
          <Button disabled>Register Asset</Button>
          <Button variant="outline" disabled>
            Create Requisition
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
            <TabsTrigger value="assets">Assets</TabsTrigger>
            <TabsTrigger value="stock">Stock</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="requisitions">Requisitions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Boxes className="h-5 w-5" />
                  Inventory Status
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Total Items Tracked</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-green-50 rounded-lg text-center">
                      <p className="text-xs text-muted-foreground mb-1">In Stock</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                    <div className="p-3 bg-yellow-50 rounded-lg text-center">
                      <p className="text-xs text-muted-foreground mb-1">Low Stock</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <AlertTriangle className="h-5 w-5" />
                  Critical Alerts
                </h3>
                <div className="space-y-2">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-medium text-green-900">✓ All systems nominal</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-4">
                    Real-time monitoring will alert you when stock levels fall below reorder points
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="assets" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Asset Register
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Add Asset
                  </Button>
                </div>
              </div>
              <div className="text-center py-12">
                <Boxes className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No assets registered yet</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="stock" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Stock Level Management
                </h3>
                <Button size="sm">
                  <TrendingDown className="h-4 w-4 mr-1" />
                  Analytics
                </Button>
              </div>
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Total SKUs</p>
                  <p className="text-3xl font-bold">0</p>
                </div>
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Reorder Points Met</p>
                  <p className="text-3xl font-bold">0%</p>
                </div>
                <div className="p-4 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Inventory Value</p>
                  <p className="text-3xl font-bold">₦0</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-6">
                <Clock className="h-5 w-5" />
                Maintenance Schedule
              </h3>
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-start gap-4">
                  <AlertCircle className="h-5 w-5 text-blue-600 mt-1 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-sm text-blue-900">
                      Preventive Maintenance Tracking
                    </p>
                    <p className="text-sm text-blue-700 mt-1">
                      Schedule and track maintenance for all equipment. Receive automated reminders
                      and manage maintenance history.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="requisitions" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Requisition Requests
                </h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New Requisition
                </Button>
              </div>
              <div className="text-center py-12">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No pending requisitions</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
