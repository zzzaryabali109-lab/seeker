import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Box,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileWarning,
  Filter,
  Layers,
  Search,
  Ship,
  Sparkles,
  TrendingUp,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { formatDistanceToNow, isToday, isFuture, isPast, parseISO, isThisWeek, isThisMonth } from 'date-fns';
import { cn } from '@/lib/utils';

interface ContainerRow {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  consignee: string | null;
  container_number: string;
  shipping_line: string | null;
  current_location: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  eta: string | null;
  last_update: string | null;
  status: string;
  origin_port: string | null;
  destination_port: string | null;
  arrival_date: string | null;
  upload_timestamp: string;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
}

interface ActivityEvent {
  id: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  email: string;
  message: string;
  at: number;
}

interface PendingUserReplacement {
  timer: ReturnType<typeof setTimeout>;
  deleted: number;
  inserted: number;
  name: string;
  email: string;
}

type TimeFilter = 'all' | 'today' | 'week' | 'month';
type StatusFilter = 'all' | 'delayed' | 'delivered' | 'docpending';

function parseEta(eta: string | null): Date | null {
  if (!eta) return null;
  const d = new Date(eta);
  if (!isNaN(d.getTime())) return d;
  try {
    return parseISO(eta);
  } catch {
    return null;
  }
}

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
};

interface BentoStatProps {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  sub?: string;
  tint: string; // text color class
  ring: string; // border tint
  glow: string; // bg radial tint
  delay?: number;
  active?: boolean;
  onClick?: () => void;
}

function BentoStat({ icon: Icon, label, value, sub, tint, ring, glow, delay = 0, active, onClick }: BentoStatProps) {
  return (
    <motion.button
      {...fadeUp}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-card/60 backdrop-blur-xl p-4 sm:p-5 text-left transition-all',
        'hover:shadow-xl hover:shadow-primary/5',
        active ? ring : 'border-border/50',
      )}
    >
      <div className={cn('absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-60 transition-opacity group-hover:opacity-100', glow)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] sm:text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {label}
          </p>
          <p className="text-2xl sm:text-3xl font-bold font-display mt-1 truncate">{value}</p>
          {sub && <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 truncate">{sub}</p>}
        </div>
        <div className={cn('shrink-0 w-10 h-10 rounded-xl flex items-center justify-center bg-background/60 border border-border/40', tint)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </motion.button>
  );
}

const TIME_FILTERS: { key: TimeFilter; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All Status' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'docpending', label: 'Docs Pending' },
];

const STATUS_LANES = [
  { key: 'in_transit', label: 'On The Way', match: (s: string) => /transit|sea|sail/i.test(s), accent: 'bg-status-in-transit', text: 'text-status-in-transit' },
  { key: 'arrived', label: 'Port Arrived', match: (s: string) => /arriv/i.test(s), accent: 'bg-status-arrived', text: 'text-status-arrived' },
  { key: 'discharged', label: 'Discharged', match: (s: string) => /discharg/i.test(s), accent: 'bg-accent', text: 'text-accent' },
  { key: 'loading', label: 'Loading', match: (s: string) => /load/i.test(s), accent: 'bg-status-transit', text: 'text-status-transit' },
  { key: 'pending', label: 'Pending', match: (s: string) => /pend|not avail/i.test(s) || !s, accent: 'bg-muted-foreground', text: 'text-muted-foreground' },
  { key: 'delayed', label: 'Delayed', match: (s: string) => /delay/i.test(s), accent: 'bg-destructive', text: 'text-destructive' },
];

export default function AdminDashboard() {
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedConsignee, setSelectedConsignee] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const replacementEventsRef = useRef(new Map<string, PendingUserReplacement>());

  const emailFor = useMemo(() => {
    const map = new Map<string, { email: string; name: string }>();
    profiles.forEach((p) => map.set(p.user_id, {
      email: p.email ?? 'unknown user',
      name: p.full_name?.trim() || p.email?.split('@')[0] || 'Unknown user',
    }));
    return (uid: string) => map.get(uid) ?? { email: 'unknown user', name: 'Unknown user' };
  }, [profiles]);

  // initial load
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [c, p] = await Promise.all([
        supabase
          .from('tracked_containers')
          .select('*')
          .order('updated_at', { ascending: false }),
        supabase.from('profiles').select('user_id, email, full_name'),
      ]);
      if (cancelled) return;
      setContainers((c.data as ContainerRow[]) ?? []);
      setProfiles((p.data as ProfileRow[]) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  // realtime
  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel('admin-containers')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tracked_containers' },
        (payload) => {
          const newRow = payload.new as ContainerRow | null;
          const oldRow = payload.old as ContainerRow | null;
          const uid = newRow?.user_id ?? oldRow?.user_id ?? '';
          const profile = emailFor(uid);
          const container = newRow?.container_number ?? oldRow?.container_number ?? '';

          setContainers((prev) => {
            if (payload.eventType === 'INSERT' && newRow) return [newRow, ...prev];
            if (payload.eventType === 'UPDATE' && newRow)
              return prev.map((r) => (r.id === newRow.id ? newRow : r));
            if (payload.eventType === 'DELETE' && oldRow)
              return prev.filter((r) => r.id !== oldRow.id);
            return prev;
          });

          if (payload.eventType === 'UPDATE') {
            setActivity((prev) => {
              const event: ActivityEvent = {
                id: `${Date.now()}-${Math.random()}`,
                type: 'UPDATE',
                email: profile.email,
                message: `${profile.name} updated container ${container}`,
                at: Date.now(),
              };
              return [event, ...prev].slice(0, 50);
            });
            return;
          }

          const existing = replacementEventsRef.current.get(uid);
          if (existing) clearTimeout(existing.timer);

          const flushType: ActivityEvent['type'] = payload.eventType === 'INSERT' ? 'INSERT' : 'DELETE';
          const nextState: PendingUserReplacement = {
            deleted: (existing?.deleted ?? 0) + (payload.eventType === 'DELETE' ? 1 : 0),
            inserted: (existing?.inserted ?? 0) + (payload.eventType === 'INSERT' ? 1 : 0),
            name: profile.name,
            email: profile.email,
            timer: setTimeout(() => {
              const finalState = replacementEventsRef.current.get(uid);
              if (!finalState) return;
              const message =
                finalState.deleted > 0 && finalState.inserted > 0
                  ? `${finalState.name} replaced Excel data · ${finalState.inserted} containers updated`
                  : finalState.inserted > 0
                    ? `${finalState.name} uploaded Excel · ${finalState.inserted} containers added`
                    : `${finalState.name} removed ${finalState.deleted} containers`;
              setActivity((prev) => {
                const event: ActivityEvent = {
                  id: `${Date.now()}-${Math.random()}`,
                  type: finalState.deleted > 0 && finalState.inserted > 0 ? 'UPDATE' : flushType,
                  email: finalState.email,
                  message,
                  at: Date.now(),
                };
                return [event, ...prev].slice(0, 50);
              });
              replacementEventsRef.current.delete(uid);
            }, 450),
          };
          replacementEventsRef.current.set(uid, nextState);
        },
      )
      .subscribe();

    return () => {
      replacementEventsRef.current.forEach((event) => clearTimeout(event.timer));
      replacementEventsRef.current.clear();
      supabase.removeChannel(channel);
    };
  }, [isAdmin, emailFor]);

  const matchesTime = (c: ContainerRow): boolean => {
    if (timeFilter === 'all') return true;
    const d = parseEta(c.arrival_date ?? c.eta);
    if (!d) return false;
    if (timeFilter === 'today') return isToday(d);
    if (timeFilter === 'week') return isThisWeek(d, { weekStartsOn: 1 });
    if (timeFilter === 'month') return isThisMonth(d);
    return true;
  };

  const isDelayed = (c: ContainerRow) => /delay/i.test(c.status || '') || c.status === 'Pending';
  const isDelivered = (c: ContainerRow) => /discharg|deliver/i.test(c.status || '');
  const isDocPending = (c: ContainerRow) => {
    const d = parseEta(c.arrival_date ?? c.eta);
    return !!d && (isPast(d) || isToday(d)) && !isDelivered(c);
  };

  const matchesStatus = (c: ContainerRow): boolean => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'delayed') return isDelayed(c);
    if (statusFilter === 'delivered') return isDelivered(c);
    if (statusFilter === 'docpending') return isDocPending(c);
    return true;
  };

  const matchesSearch = (c: ContainerRow): boolean => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (c.consignee || '').toLowerCase().includes(q) ||
      c.container_number.toLowerCase().includes(q) ||
      (c.user_name || '').toLowerCase().includes(q) ||
      (c.user_email || '').toLowerCase().includes(q)
    );
  };

  const filtered = useMemo(
    () => containers.filter((c) => matchesTime(c) && matchesStatus(c) && matchesSearch(c)),
    [containers, timeFilter, statusFilter, search],
  );

  // derived stats from filtered set
  const stats = useMemo(() => {
    const todayArrivals = filtered.filter((c) => {
      const d = parseEta(c.arrival_date ?? c.eta);
      return d && isToday(d);
    });
    const upcoming = filtered.filter((c) => {
      const d = parseEta(c.arrival_date ?? c.eta);
      return d && isFuture(d) && !isToday(d);
    });
    const delayed = filtered.filter(isDelayed);
    const delivered = filtered.filter(isDelivered);
    const docPending = filtered.filter(isDocPending);
    const consigneeSet = new Set(filtered.map((c) => c.consignee?.trim()).filter(Boolean) as string[]);
    const activeUsers = new Set(filtered.map((c) => c.user_id)).size;

    return {
      total: filtered.length,
      todayArrivals: todayArrivals.length,
      upcoming: upcoming.length,
      delayed: delayed.length,
      delivered: delivered.length,
      docPending: docPending.length,
      consignees: consigneeSet.size,
      activeUsers,
      todayArrivalsList: todayArrivals,
    };
  }, [filtered]);

  const statusLanes = useMemo(() => {
    const max = Math.max(1, ...STATUS_LANES.map((lane) => filtered.filter((c) => lane.match(c.status || '')).length));
    return STATUS_LANES.map((lane) => {
      const count = filtered.filter((c) => lane.match(c.status || '')).length;
      return { ...lane, count, pct: Math.round((count / max) * 100) };
    });
  }, [filtered]);

  const consignees = useMemo(() => {
    const map = new Map<
      string,
      { name: string; total: number; today: number; upcoming: number; rows: ContainerRow[] }
    >();
    for (const c of filtered) {
      const name = (c.consignee || 'Unassigned').trim() || 'Unassigned';
      const entry = map.get(name) ?? { name, total: 0, today: 0, upcoming: 0, rows: [] as ContainerRow[] };
      entry.total += 1;
      entry.rows.push(c);
      const d = parseEta(c.arrival_date ?? c.eta);
      if (d && isToday(d)) entry.today += 1;
      else if (d && isFuture(d)) entry.upcoming += 1;
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const userOverview = useMemo(() => {
    const map = new Map<string, { userId: string; name: string; email: string; total: number; consignees: Set<string>; rows: ContainerRow[]; lastActive: number; uploads: Set<string> }>();
    for (const container of filtered) {
      const profile = emailFor(container.user_id);
      const name = container.user_name?.trim() || profile.name;
      const email = container.user_email?.trim() || profile.email;
      const entry = map.get(container.user_id) ?? {
        userId: container.user_id,
        name,
        email,
        total: 0,
        consignees: new Set<string>(),
        rows: [] as ContainerRow[],
        lastActive: 0,
        uploads: new Set<string>(),
      };
      entry.total += 1;
      if (container.consignee) entry.consignees.add(container.consignee);
      entry.rows.push(container);
      const ts = new Date(container.updated_at || container.upload_timestamp).getTime();
      if (ts > entry.lastActive) entry.lastActive = ts;
      entry.uploads.add(container.upload_timestamp || '');
      map.set(container.user_id, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered, emailFor]);

  const selectedUser = useMemo(
    () => userOverview.find((entry) => entry.userId === selectedUserId) ?? null,
    [userOverview, selectedUserId],
  );

  const todayByConsignee = useMemo(
    () => consignees.filter((c) => c.today > 0).sort((a, b) => b.today - a.today).slice(0, 8),
    [consignees],
  );

  const topConsignees = useMemo(() => consignees.slice(0, 6), [consignees]);

  const selected = useMemo(
    () => consignees.find((c) => c.name === selectedConsignee) ?? null,
    [consignees, selectedConsignee],
  );

  // gating
  if (authLoading || roleLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto p-6 space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!roleLoading && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Access Denied</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You don't have permission to view the Admin Dashboard.
            </p>
            <a
              href="/dashboard"
              className="inline-flex items-center text-sm font-semibold text-primary hover:underline"
            >
              ← Back to your dashboard
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <Header />

      {/* Sticky hero */}
      <div className="sticky top-[64px] z-30 backdrop-blur-xl bg-background/80 border-b border-border/40">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-primary via-accent to-primary flex items-center justify-center shadow-lg shadow-primary/20">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold font-display truncate">Control Tower</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground -mt-0.5 truncate">
                Live operations · {stats.activeUsers} active users · {stats.total} containers
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

      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
        {/* Filters bar */}
        <section className="rounded-2xl border border-border/50 bg-card/60 backdrop-blur-xl p-3 sm:p-4 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user, consignee or container…"
                className="pl-9 bg-background/60"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-muted"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Filter className="w-3.5 h-3.5" />
              <span className="font-semibold">Filters</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TIME_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setTimeFilter(f.key)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                  timeFilter === f.key
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/20'
                    : 'bg-background/40 text-muted-foreground border-border/50 hover:border-primary/30 hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
            <span className="w-px h-6 bg-border/60 mx-1 self-center" />
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-all',
                  statusFilter === f.key
                    ? 'bg-accent text-accent-foreground border-accent shadow-sm shadow-accent/20'
                    : 'bg-background/40 text-muted-foreground border-border/50 hover:border-accent/30 hover:text-foreground',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {/* Stat grid - 8 bento cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8 gap-3">
          <BentoStat
            icon={Box} label="Total" value={stats.total} sub="containers"
            tint="text-primary" ring="border-primary/40" glow="bg-primary/20"
            delay={0} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}
          />
          <BentoStat
            icon={Truck} label="Today" value={stats.todayArrivals} sub="arrivals"
            tint="text-accent" ring="border-accent/40" glow="bg-accent/20"
            delay={0.04} active={timeFilter === 'today'} onClick={() => setTimeFilter('today')}
          />
          <BentoStat
            icon={CalendarClock} label="Upcoming" value={stats.upcoming} sub="containers"
            tint="text-status-in-transit" ring="border-status-in-transit/40" glow="bg-status-in-transit/20"
            delay={0.08}
          />
          <BentoStat
            icon={Ship} label="Consignees" value={stats.consignees} sub="unique"
            tint="text-primary" ring="border-primary/40" glow="bg-primary/20"
            delay={0.12}
          />
          <BentoStat
            icon={Users} label="Active Users" value={stats.activeUsers} sub="uploading"
            tint="text-accent" ring="border-accent/40" glow="bg-accent/20"
            delay={0.16}
          />
          <BentoStat
            icon={Clock} label="Delayed" value={stats.delayed} sub="needs attention"
            tint="text-destructive" ring="border-destructive/40" glow="bg-destructive/20"
            delay={0.2} active={statusFilter === 'delayed'} onClick={() => setStatusFilter('delayed')}
          />
          <BentoStat
            icon={CheckCircle2} label="Delivered" value={stats.delivered} sub="discharged"
            tint="text-status-arrived" ring="border-status-arrived/40" glow="bg-status-arrived/20"
            delay={0.24} active={statusFilter === 'delivered'} onClick={() => setStatusFilter('delivered')}
          />
          <BentoStat
            icon={FileWarning} label="Docs Pending" value={stats.docPending} sub="awaiting"
            tint="text-status-transit" ring="border-status-transit/40" glow="bg-status-transit/20"
            delay={0.28} active={statusFilter === 'docpending'} onClick={() => setStatusFilter('docpending')}
          />
        </section>

        {/* Container Status Overview - visual lanes */}
        <section>
          <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    Container Status Overview
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px]">{stats.total} total</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {statusLanes.map((lane) => (
                  <div key={lane.key} className="flex items-center gap-3">
                    <div className="w-28 sm:w-32 shrink-0 text-xs sm:text-sm font-semibold truncate">{lane.label}</div>
                    <div className="flex-1 h-2.5 rounded-full bg-muted/40 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${lane.pct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                        className={cn('h-full rounded-full', lane.accent)}
                      />
                    </div>
                    <div className={cn('w-10 text-right text-sm font-bold', lane.text)}>{lane.count}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {/* Today arrivals + Live Activity */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <motion.div {...fadeUp} transition={{ duration: 0.4 }} className="lg:col-span-2">
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-primary" />
                    Today's Arrivals
                  </CardTitle>
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/15 border-0">
                    {stats.todayArrivals} containers
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {todayByConsignee.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No arrivals scheduled for today.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {todayByConsignee.map((c) => (
                      <button
                        key={c.name}
                        onClick={() => setSelectedConsignee(c.name)}
                        className="group text-left p-3 rounded-xl border border-border/50 bg-gradient-to-br from-muted/40 to-transparent hover:from-primary/5 hover:border-primary/30 transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-sm truncate">{c.name}</p>
                          <span className="text-xs font-bold text-primary shrink-0">{c.today}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {c.today} arriving · {c.total} total
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Activity className="w-4 h-4 text-accent" />
                  Live Activity
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[320px] px-6 pb-4">
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">Waiting for activity…</p>
                  ) : (
                    <ul className="space-y-2.5">
                      <AnimatePresence initial={false}>
                        {activity.map((e) => (
                          <motion.li
                            key={e.id}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex items-start gap-3 text-sm"
                          >
                            <span
                              className={cn(
                                'mt-1.5 w-1.5 h-1.5 rounded-full shrink-0',
                                e.type === 'INSERT' ? 'bg-status-arrived' :
                                e.type === 'UPDATE' ? 'bg-primary' : 'bg-destructive',
                              )}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="leading-tight truncate">{e.message}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {formatDistanceToNow(e.at, { addSuffix: true })}
                              </p>
                            </div>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {/* Top Consignees */}
        <section>
          <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Ship className="w-4 h-4 text-primary" />
                  Top Consignees
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topConsignees.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No consignees yet.</p>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
                    {topConsignees.map((c, i) => (
                      <motion.button
                        key={c.name}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3, delay: i * 0.04 }}
                        whileHover={{ y: -2 }}
                        onClick={() => setSelectedConsignee(c.name)}
                        className="text-left rounded-xl border border-border/50 bg-gradient-to-br from-primary/5 to-transparent p-3 hover:border-primary/40 hover:shadow-md transition-all"
                      >
                        <p className="font-semibold text-sm truncate">{c.name}</p>
                        <p className="text-2xl font-bold font-display text-primary mt-1">{c.total}</p>
                        <p className="text-[10px] text-muted-foreground">containers</p>
                      </motion.button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {/* User Overview + Inspector */}
        <section className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <motion.div {...fadeUp} transition={{ duration: 0.4 }} className="xl:col-span-2">
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Live Users
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {userOverview.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">No user uploads yet.</p>
                ) : (
                  userOverview.map((entry) => {
                    const initial = (entry.name || entry.email || '?').trim().charAt(0).toUpperCase();
                    return (
                      <div key={entry.userId} className="flex items-stretch gap-2">
                        <button
                          onClick={() => setSelectedUserId(entry.userId)}
                          className={cn(
                            'flex-1 text-left rounded-xl border px-3 py-3 transition-all',
                            selectedUserId === entry.userId
                              ? 'border-primary/40 bg-primary/5 shadow-sm'
                              : 'border-border/50 bg-muted/20 hover:border-primary/30 hover:bg-primary/5',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold text-sm shrink-0">
                              {initial}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold truncate text-sm">{entry.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{entry.email}</p>
                            </div>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {entry.total}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                            <span>{entry.consignees.size} consignees</span>
                            <span>·</span>
                            <span>{entry.uploads.size} uploads</span>
                            {entry.lastActive > 0 && (
                              <>
                                <span>·</span>
                                <span className="text-status-arrived">{formatDistanceToNow(entry.lastActive, { addSuffix: true })}</span>
                              </>
                            )}
                          </div>
                        </button>
                        <Link
                          to={`/admin/user/${entry.userId}`}
                          className="shrink-0 rounded-xl border border-border/50 bg-muted/20 px-3 flex items-center text-xs font-semibold text-primary hover:bg-primary/5 hover:border-primary/30 transition-colors"
                        >
                          View →
                        </Link>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.05 }} className="xl:col-span-3">
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg">User Inspector</CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedUser ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">Select a user to inspect uploads, consignees, containers, and arrival dates.</p>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-xl bg-gradient-to-br from-primary/10 to-transparent border border-primary/20 p-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">User</p>
                        <p className="font-semibold mt-1 truncate">{selectedUser.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{selectedUser.email}</p>
                      </div>
                      <div className="rounded-xl bg-gradient-to-br from-accent/10 to-transparent border border-accent/20 p-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Containers</p>
                        <p className="font-semibold mt-1 text-2xl font-display">{selectedUser.total}</p>
                      </div>
                      <div className="rounded-xl bg-gradient-to-br from-status-arrived/10 to-transparent border border-status-arrived/20 p-4">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide">Consignees</p>
                        <p className="font-semibold mt-1 text-2xl font-display">{selectedUser.consignees.size}</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/50 overflow-hidden">
                      <div className="grid grid-cols-12 px-4 py-2.5 bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="col-span-4">Consignee</div>
                        <div className="col-span-3">Container</div>
                        <div className="col-span-3">Arrival</div>
                        <div className="col-span-2 text-right">Uploaded</div>
                      </div>
                      <div className="divide-y divide-border max-h-[320px] overflow-y-auto">
                        {selectedUser.rows.slice().sort((a, b) => (b.upload_timestamp || '').localeCompare(a.upload_timestamp || '')).map((row) => (
                          <div key={row.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm items-center">
                            <div className="col-span-4 truncate">{row.consignee || 'Unassigned'}</div>
                            <div className="col-span-3 font-mono truncate">{row.container_number}</div>
                            <div className="col-span-3 truncate">{(parseEta(row.arrival_date ?? row.eta)?.toLocaleDateString()) || '—'}</div>
                            <div className="col-span-2 text-right text-xs text-muted-foreground">
                              {row.upload_timestamp ? formatDistanceToNow(new Date(row.upload_timestamp), { addSuffix: true }) : '—'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </section>

        {/* Consignees grid */}
        <section className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg sm:text-xl font-bold font-display">All Consignees</h2>
            <Badge variant="outline" className="text-[10px] w-fit">{consignees.length} total</Badge>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-2xl" />
              ))}
            </div>
          ) : consignees.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No consignees match your filters.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {consignees.map((c, i) => (
                <motion.button
                  key={c.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.02, 0.3) }}
                  whileHover={{ y: -3 }}
                  onClick={() => setSelectedConsignee(c.name)}
                  className="text-left"
                >
                  <Card className="border-border/60 bg-card/60 backdrop-blur-xl hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all h-full overflow-hidden">
                    <CardContent className="p-4 space-y-3 relative">
                      <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-primary/10 blur-2xl" />
                      <div className="relative flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{c.name}</p>
                          <p className="text-[11px] text-muted-foreground">{c.total} containers</p>
                        </div>
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                          <Ship className="w-4 h-4 text-primary" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 relative">
                        <div className="rounded-lg bg-primary/5 border border-primary/10 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Today</p>
                          <p className="text-lg font-bold text-primary">{c.today}</p>
                        </div>
                        <div className="rounded-lg bg-accent/5 border border-accent/10 p-2">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Upcoming</p>
                          <p className="text-lg font-bold text-accent">{c.upcoming}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </motion.button>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Consignee detail */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedConsignee(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ship className="w-4 h-4 text-primary" />
              {selected?.name}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-2">
                {selected.rows
                  .slice()
                  .sort((a, b) => {
                    const da = parseEta(a.arrival_date ?? a.eta)?.getTime() ?? Infinity;
                    const db = parseEta(b.arrival_date ?? b.eta)?.getTime() ?? Infinity;
                    return da - db;
                  })
                  .map((r) => (
                    <div
                      key={r.id}
                      className="p-3 rounded-xl border border-border/50 bg-muted/20 flex items-start justify-between gap-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-mono font-semibold text-sm truncate">{r.container_number}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.vessel_name || '—'} · {r.current_location || '—'}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          User: {r.user_name || emailFor(r.user_id).name}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {(parseEta(r.arrival_date ?? r.eta)?.toLocaleDateString()) || '—'}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
