import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  Users,
  LogIn,
  Lock,
  BarChart3,
  AlertCircle,
  CheckCircle2,
  Plus,
  Filter,
  Clock,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/visitors")({
  ssr: false,
  component: AdminVisitorsPage,
});

function AdminVisitorsPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    { label: "Today's Visitors", value: "0", icon: Users, color: "from-blue-500 to-blue-600" },
    { label: "Checked In", value: "0", icon: LogIn, color: "from-green-500 to-green-600" },
    { label: "Active Passes", value: "0", icon: Lock, color: "from-purple-500 to-purple-600" },
    {
      label: "Security Status",
      value: "Secure",
      icon: Shield,
      color: "from-emerald-500 to-emerald-600",
    },
  ];

  return (
    <PortalPage
      title="Visitor Management & Gate Control"
      subtitle="Real-time visitor tracking, pass management, and comprehensive security monitoring"
      actions={
        <>
          <Button disabled>Check In Visitor</Button>
          <Button variant="outline" disabled>
            Issue Pass
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
            <TabsTrigger value="checkin">Check-In</TabsTrigger>
            <TabsTrigger value="passes">Passes</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="security">Security</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Users className="h-5 w-5" />
                  Visitor Status
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Total Visitors Today</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-green-50 rounded-lg text-center">
                      <p className="text-xs text-muted-foreground mb-1">Checked In</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                    <div className="p-3 bg-orange-50 rounded-lg text-center">
                      <p className="text-xs text-muted-foreground mb-1">Pending</p>
                      <p className="text-2xl font-bold">0</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Lock className="h-5 w-5" />
                  Pass Management
                </h3>
                <div className="space-y-3">
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Passes Issued Today</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                  <div className="p-4 bg-indigo-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Passes Revoked</p>
                    <p className="text-3xl font-bold">0</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <Shield className="h-5 w-5" />
                Security Overview
              </h3>
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">✓ Access Control</p>
                  <p className="text-xs text-green-700">All gates monitored</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">✓ Incident Log</p>
                  <p className="text-xs text-green-700">No issues detected</p>
                </div>
                <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                  <p className="text-sm font-medium text-green-900 mb-1">✓ Alerts</p>
                  <p className="text-xs text-green-700">Real-time notifications</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="checkin" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <LogIn className="h-5 w-5" />
                  Visitor Check-In
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    Check In
                  </Button>
                </div>
              </div>
              <div className="text-center py-12">
                <LogIn className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No visitors checked in yet</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="passes" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Lock className="h-5 w-5" />
                  Visitor Passes
                </h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Issue Pass
                </Button>
              </div>
              <div className="space-y-2">
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <p className="text-sm font-medium text-blue-900">Digital Pass System</p>
                  <p className="text-xs text-blue-700 mt-1">
                    Generate and manage temporary visitor passes with QR codes and automatic expiry
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Visitor History
                </h3>
                <Button size="sm" variant="outline">
                  <Filter className="h-4 w-4 mr-1" />
                  Filter
                </Button>
              </div>
              <div className="text-center py-12">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No visitor history yet</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="security" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <BarChart3 className="h-5 w-5" />
                  Security Analytics
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-muted-foreground mb-1">Peak Visit Time</p>
                    <p className="font-medium">9:00 AM - 10:00 AM</p>
                  </div>
                  <div className="p-3 bg-purple-50 rounded-lg">
                    <p className="text-muted-foreground mb-1">Incidents Today</p>
                    <p className="font-medium text-green-600">None</p>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <AlertCircle className="h-5 w-5" />
                  Security Alerts
                </h3>
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm font-medium text-green-900">✓ All secure</p>
                  <p className="text-xs text-green-700 mt-1">No active security concerns</p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
