import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { useState } from "react";
import {
  Users,
  Trophy,
  Calendar,
  BarChart3,
  Heart,
  MessageSquare,
  Plus,
  Filter,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/admin/extracurricular")({
  ssr: false,
  component: AdminExtracurricularPage,
});

function AdminExtracurricularPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const stats = [
    { label: "Active Clubs", value: "0", icon: Users, color: "from-blue-500 to-blue-600" },
    { label: "Total Members", value: "0", icon: Trophy, color: "from-purple-500 to-purple-600" },
    { label: "Upcoming Events", value: "0", icon: Calendar, color: "from-green-500 to-green-600" },
    {
      label: "Engagement Rate",
      value: "0%",
      icon: TrendingUp,
      color: "from-emerald-500 to-emerald-600",
    },
  ];

  return (
    <PortalPage
      title="Extracurricular & Activities Hub"
      subtitle="Comprehensive club management, student engagement, and event coordination"
      actions={
        <>
          <Button disabled>Create Club</Button>
          <Button variant="outline" disabled>
            Schedule Event
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="clubs">Clubs</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="insights">Insights</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Users className="h-5 w-5" />
                  Student Participation
                </h3>
                <div className="space-y-4">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Active Participants</p>
                    <p className="text-2xl font-bold">0</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Total Memberships</p>
                    <p className="text-2xl font-bold">0</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">Average per Club</p>
                    <p className="text-2xl font-bold">0</p>
                  </div>
                </div>
              </div>

              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <Calendar className="h-5 w-5" />
                  Upcoming Activities
                </h3>
                <div className="space-y-3">
                  <div className="p-4 border border-border rounded-lg hover:bg-accent/50">
                    <p className="font-medium text-sm">No events scheduled</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Create new events to engage students
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <Heart className="h-5 w-5" />
                Featured Initiatives
              </h3>
              <div className="grid lg:grid-cols-3 gap-4">
                <div className="p-4 bg-gradient-to-br from-red-50 to-red-100 rounded-lg">
                  <p className="font-medium text-sm mb-2">Mentorship Programs</p>
                  <p className="text-xs text-muted-foreground">Pair senior and junior members</p>
                </div>
                <div className="p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg">
                  <p className="font-medium text-sm mb-2">Inter-Club Competitions</p>
                  <p className="text-xs text-muted-foreground">Build healthy competition</p>
                </div>
                <div className="p-4 bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg">
                  <p className="font-medium text-sm mb-2">Community Service</p>
                  <p className="text-xs text-muted-foreground">Social impact activities</p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="clubs" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Trophy className="h-5 w-5" />
                  Club Directory
                </h3>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline">
                    <Filter className="h-4 w-4 mr-1" />
                    Filter
                  </Button>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" />
                    New Club
                  </Button>
                </div>
              </div>
              <div className="text-center py-12">
                <Trophy className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No clubs created yet</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="events" className="space-y-6 mt-6">
            <div className="uos-card p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Activity Calendar
                </h3>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  Schedule Event
                </Button>
              </div>
              <div className="text-center py-12">
                <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-30" />
                <p className="text-muted-foreground">No events scheduled</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="insights" className="space-y-6 mt-6">
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <BarChart3 className="h-5 w-5" />
                  Participation Trends
                </h3>
                <div className="p-6 bg-blue-50 rounded-lg text-center">
                  <p className="text-muted-foreground text-sm">
                    Data will appear after activities start
                  </p>
                </div>
              </div>
              <div className="uos-card p-6">
                <h3 className="font-semibold flex items-center gap-2 mb-4">
                  <MessageSquare className="h-5 w-5" />
                  Engagement Analysis
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="font-medium text-green-900">✓ System Ready</p>
                  </div>
                  <p className="text-muted-foreground">
                    Advanced analytics will track member engagement, event attendance, and
                    participation metrics
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </PortalPage>
  );
}
