import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  User as UserIcon, Mail, Calendar, Box, Users, Activity, History,
  TrendingUp, ChevronRight, Truck, Sparkles,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

interface Row {
  id: string;
  container_number: string;
  consignee: string | null;
  arrival_date: string | null;
  eta: string | null;
  status: string;
  upload_timestamp: string;
  created_at: string;
  updated_at: string;
}

interface Profile {
  full_name: string | null;
  email: string | null;
  created_at: string | null;
}

const fadeUp = { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

const parseIso = (s: string | null) => {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const daysFromToday = (d: Date | null) => {
  if (!d) return null;
  const t = new Date();
  t.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
};

const formatDate = (s: string | null) => {
  const d = parseIso(s);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatRelative = (s: string | null) => {
  const d = s ? new Date(s) : null;
  if (!d || isNaN(d.getTime())) return '—';
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function Profile() {
  const { user, loading: authLoading } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const [c, p] = await Promise.all([
        supabase
          .from('tracked_containers')
          .select('id, container_number, consignee, arrival_date, eta, status, upload_timestamp, created_at, updated_at')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false }),
        supabase.from('profiles').select('full_name, email, created_at').eq('user_id', user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      setRows((c.data as Row[]) ?? []);
      setProfile((p.data as Profile) ?? { full_name: null, email: user.email ?? null, created_at: null });
      setLoading(false);
    };
    load();
    const channel = supabase
      .channel(`profile-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tracked_containers', filter: `user_id=eq.${user.id}` },
        load,
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user]);

  const stats = useMemo(() => {
    const consigneeSet = new Set<string>();
    let today = 0, upcoming = 0, delayed = 0;
    rows.forEach((r) => {
      if (r.consignee) consigneeSet.add(r.consignee.trim());
      const days = daysFromToday(parseIso(r.arrival_date ?? r.eta));
      if (days === 0) today++;
      else if (days !== null && days > 0) upcoming++;
      else if (days !== null && days < 0) delayed++;
    });
    return { total: rows.length, consignees: consigneeSet.size, today, upcoming, delayed };
  }, [rows]);

  const consigneeGroups = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const name = (r.consignee || 'Unassigned').trim() || 'Unassigned';
      map.set(name, (map.get(name) ?? 0) + 1);
    });
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const uploadHistory = useMemo(() => {
    const map = new Map<string, { ts: string; count: number }>();
    rows.forEach((r) => {
      const ts = r.upload_timestamp || r.created_at;
      if (!ts) return;
      const day = ts.slice(0, 10);
      const entry = map.get(day) ?? { ts, count: 0 };
      entry.count += 1;
      if (ts > entry.ts) entry.ts = ts;
      map.set(day, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8);
  }, [rows]);

  const activity = useMemo(() => {
    return rows.slice(0, 10).map((r) => ({
      id: r.id,
      container: r.container_number,
      consignee: r.consignee || 'Unassigned',
      when: r.updated_at,
    }));
  }, [rows]);

  const upcoming = useMemo(() => {
    return rows
      .map((r) => ({ row: r, d: parseIso(r.arrival_date ?? r.eta) }))
      .filter((x) => x.d && x.d.getTime() >= Date.now() - 86400000)
      .sort((a, b) => (a.d!.getTime() - b.d!.getTime()))
      .slice(0, 6);
  }, [rows]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto p-6 space-y-4">
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const displayName =
    profile?.full_name?.trim() ||
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    user.email?.split('@')[0] ||
    'You';
  const initials = displayName
    .split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || 'U';

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <Header />

      <div className="sticky top-[64px] z-30 backdrop-blur-xl bg-background/80 border-b border-border/40">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
              <UserIcon className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold font-display truncate">Profile</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground -mt-0.5 truncate">
                Your account & shipment activity
              </p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1.5 border-status-arrived/30 bg-status-arrived/5 text-status-arrived shrink-0">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-arrived opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-status-arrived" />
            </span>
            <span className="text-[10px] sm:text-xs font-semibold">LIVE</span>
          </Badge>
        </div>
      </div>

      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* Top profile card */}
        <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
          <Card className="relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-xl">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 pointer-events-none" />
            <CardContent className="p-5 sm:p-6 relative">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground text-2xl sm:text-3xl font-bold font-display shrink-0">
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl sm:text-2xl font-bold font-display truncate">{displayName}</h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{profile?.email ?? user.email}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" /> Joined {formatRelative(profile?.created_at ?? user.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                  <div className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-border/50 bg-muted/30 text-center">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Containers</p>
                    <p className="text-lg font-bold font-display">{stats.total}</p>
                  </div>
                  <div className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl border border-border/50 bg-muted/30 text-center">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Consignees</p>
                    <p className="text-lg font-bold font-display">{stats.consignees}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl">
              <CardContent className="p-8 sm:p-12 text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-display">No activity yet</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Upload an Excel file to populate your profile.
                  </p>
                </div>
                <Link to="/invoice-generator">
                  <Button className="gap-2 rounded-xl"><Truck className="w-4 h-4" /> Go to On The Way</Button>
                </Link>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <>
            {/* Arrival analytics stats */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { icon: Box, label: 'Total', value: stats.total, accent: 'bg-primary' },
                { icon: Truck, label: 'Today', value: stats.today, accent: 'bg-accent' },
                { icon: TrendingUp, label: 'Upcoming', value: stats.upcoming, accent: 'bg-status-in-transit' },
                { icon: Activity, label: 'Delayed', value: stats.delayed, accent: 'bg-destructive' },
              ].map((s, i) => (
                <motion.div key={s.label} {...fadeUp} transition={{ duration: 0.4, delay: i * 0.05 }}>
                  <Card className="relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-xl">
                    <div className={`absolute inset-x-0 top-0 h-1 ${s.accent}`} />
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground font-medium">{s.label}</p>
                          <p className="text-2xl sm:text-3xl font-bold font-display mt-1">{s.value}</p>
                        </div>
                        <div className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${s.accent} bg-opacity-15 flex items-center justify-center`}>
                          <s.icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </section>

            {/* Bento: Consignee Grid + Activity Feed */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <motion.div {...fadeUp} transition={{ duration: 0.4 }} className="lg:col-span-2">
                <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
                  <CardHeader className="pb-3 flex-row items-center justify-between gap-2 space-y-0">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" /> Consignee Grid
                    </CardTitle>
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/15 border-0">
                      {consigneeGroups.length}
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {consigneeGroups.slice(0, 10).map((g) => (
                        <Link
                          to="/invoice-generator"
                          key={g.name}
                          className="group p-3 rounded-xl border border-border/50 bg-gradient-to-br from-muted/40 to-transparent hover:from-primary/5 hover:border-primary/30 transition-all flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{g.name}</p>
                            <p className="text-[10px] text-muted-foreground">{g.count} container{g.count === 1 ? '' : 's'}</p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                        </Link>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.05 }}>
                <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" /> Activity Feed
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {activity.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No recent activity.</p>
                    ) : activity.map((a) => (
                      <div key={a.id} className="p-2.5 rounded-xl border border-border/50 bg-muted/20">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold truncate">{a.container}</span>
                          <span className="text-[10px] text-muted-foreground shrink-0">{formatRelative(a.when)}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{a.consignee}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            </section>

            {/* Bento: Upload History + Upcoming Arrivals */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
                <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <History className="w-4 h-4 text-primary" /> Upload History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {uploadHistory.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No uploads yet.</p>
                    ) : uploadHistory.map((u) => (
                      <div key={u.ts} className="p-3 rounded-xl border border-border/50 bg-muted/20 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{formatDate(u.ts.slice(0, 10))}</p>
                          <p className="text-[11px] text-muted-foreground">{formatRelative(u.ts)}</p>
                        </div>
                        <Badge variant="outline" className="border-primary/30 bg-primary/5 text-primary shrink-0">
                          {u.count} containers
                        </Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.05 }}>
                <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" /> Arrival Analytics
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {upcoming.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">No upcoming arrivals.</p>
                    ) : upcoming.map(({ row, d }) => (
                      <Link
                        key={row.id}
                        to="/invoice-generator"
                        className="group flex items-center justify-between gap-2 p-3 rounded-xl border border-border/50 bg-gradient-to-br from-muted/30 to-transparent hover:from-primary/5 hover:border-primary/30 transition-all"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold truncate">{row.container_number}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{row.consignee || 'Unassigned'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xs font-medium">{d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'}</p>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary inline transition-colors" />
                        </div>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              </motion.div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
