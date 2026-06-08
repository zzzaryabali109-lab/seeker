import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowLeft,
  Box,
  CalendarClock,
  Clock,
  Mail,
  Search,
  Ship,
  Truck,
  Upload,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import {
  formatDistanceToNow,
  isToday,
  isFuture,
  isThisWeek,
  isThisMonth,
  parseISO,
} from 'date-fns';

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
  arrival_date: string | null;
  upload_timestamp: string;
  created_at: string;
  updated_at: string;
}

interface ProfileRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
}

interface ActivityEvent {
  id: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  message: string;
  at: number;
}

interface PendingReplacement {
  timer: ReturnType<typeof setTimeout>;
  deleted: number;
  inserted: number;
}

type DateFilter = 'all' | 'today' | 'week' | 'month';
type SortFilter = 'latest' | 'oldest' | 'az';
type StatusFilter = 'all' | 'soon' | 'delayed' | 'upcoming';

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

function BentoStat({
  icon: Icon,
  label,
  value,
  accent,
  className = '',
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent: string;
  className?: string;
}) {
  return (
    <Card className={`relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-xl hover:shadow-lg transition-shadow ${className}`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground font-medium">
              {label}
            </p>
            <p className="text-2xl sm:text-3xl font-bold font-display mt-1 truncate">
              {value}
            </p>
          </div>
          <div className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${accent} bg-opacity-15 flex items-center justify-center`}>
            <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminUserDetail() {
  const { userId } = useParams<{ userId: string }>();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const replacementRef = useRef<PendingReplacement | null>(null);

  const [consigneeSearch, setConsigneeSearch] = useState('');
  const [containerSearch, setContainerSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [sortFilter, setSortFilter] = useState<SortFilter>('latest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedConsignee, setSelectedConsignee] = useState<string | null>(null);

  // initial load
  useEffect(() => {
    if (!isAdmin || !userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [c, p] = await Promise.all([
        supabase
          .from('tracked_containers')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('profiles')
          .select('user_id, email, full_name, created_at')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setContainers((c.data as ContainerRow[]) ?? []);
      setProfile((p.data as ProfileRow) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdmin, userId]);

  // realtime for this user only
  useEffect(() => {
    if (!isAdmin || !userId) return;
    const channel = supabase
      .channel(`admin-user-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tracked_containers',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newRow = payload.new as ContainerRow | null;
          const oldRow = payload.old as ContainerRow | null;
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
                message: `Updated container ${container}`,
                at: Date.now(),
              };
              return [event, ...prev].slice(0, 50);
            });
            return;
          }

          if (replacementRef.current) {
            clearTimeout(replacementRef.current.timer);
          }

          const flushType: ActivityEvent['type'] = payload.eventType === 'INSERT' ? 'INSERT' : 'DELETE';
          const nextState: PendingReplacement = {
            deleted: (replacementRef.current?.deleted ?? 0) + (payload.eventType === 'DELETE' ? 1 : 0),
            inserted: (replacementRef.current?.inserted ?? 0) + (payload.eventType === 'INSERT' ? 1 : 0),
            timer: setTimeout(() => {
              const finalState = replacementRef.current;
              if (!finalState) return;

              const message =
                finalState.deleted > 0 && finalState.inserted > 0
                  ? `Updated Excel data · Old data replaced with new upload · ${finalState.inserted} containers updated`
                  : finalState.inserted > 0
                    ? `Uploaded Excel data · ${finalState.inserted} containers added`
                    : `Removed ${finalState.deleted} containers`;

              setActivity((prev) => {
                const event: ActivityEvent = {
                  id: `${Date.now()}-${Math.random()}`,
                  type: finalState.deleted > 0 && finalState.inserted > 0 ? 'UPDATE' : flushType,
                  message,
                  at: Date.now(),
                };
                return [event, ...prev].slice(0, 50);
              });

              replacementRef.current = null;
            }, 450),
          };

          replacementRef.current = nextState;
        },
      )
      .subscribe();
    return () => {
      if (replacementRef.current) {
        clearTimeout(replacementRef.current.timer);
        replacementRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [isAdmin, userId]);

  const displayName = useMemo(() => {
    if (profile?.full_name?.trim()) return profile.full_name.trim();
    const fromContainer = containers.find((c) => c.user_name?.trim())?.user_name?.trim();
    if (fromContainer) return fromContainer;
    return profile?.email?.split('@')[0] || 'User';
  }, [profile, containers]);

  const displayEmail = useMemo(() => {
    if (profile?.email) return profile.email;
    return containers.find((c) => c.user_email)?.user_email || '—';
  }, [profile, containers]);

  const lastActive = useMemo(() => {
    if (containers.length === 0) return null;
    const ts = containers
      .map((c) => new Date(c.updated_at).getTime())
      .filter((n) => !isNaN(n));
    return ts.length ? new Date(Math.max(...ts)) : null;
  }, [containers]);

  // stats
  const stats = useMemo(() => {
    const todayArrivals = containers.filter((c) => {
      const d = parseEta(c.arrival_date ?? c.eta);
      return d && isToday(d);
    });
    const upcoming = containers.filter((c) => {
      const d = parseEta(c.arrival_date ?? c.eta);
      return d && isFuture(d) && !isToday(d);
    });
    const delayed = containers.filter(
      (c) => (c.status || '').toLowerCase().includes('delay'),
    );
    const consigneeSet = new Set(
      containers.map((c) => c.consignee?.trim()).filter(Boolean) as string[],
    );
    const uploadStamps = new Set(containers.map((c) => c.upload_timestamp));
    const latestUpload = containers
      .map((c) => new Date(c.upload_timestamp).getTime())
      .filter((n) => !isNaN(n))
      .sort((a, b) => b - a)[0];

    return {
      total: containers.length,
      today: todayArrivals.length,
      upcoming: upcoming.length,
      delayed: delayed.length,
      consignees: consigneeSet.size,
      uploads: uploadStamps.size,
      latestUpload: latestUpload ? new Date(latestUpload) : null,
    };
  }, [containers]);

  // apply filters
  const filteredContainers = useMemo(() => {
    let rows = containers.slice();
    const cs = consigneeSearch.trim().toLowerCase();
    const cn = containerSearch.trim().toLowerCase();
    if (cs) rows = rows.filter((r) => (r.consignee || '').toLowerCase().includes(cs));
    if (cn) rows = rows.filter((r) => r.container_number.toLowerCase().includes(cn));
    if (dateFilter !== 'all') {
      rows = rows.filter((r) => {
        const d = parseEta(r.arrival_date ?? r.eta);
        if (!d) return false;
        if (dateFilter === 'today') return isToday(d);
        if (dateFilter === 'week') return isThisWeek(d);
        if (dateFilter === 'month') return isThisMonth(d);
        return true;
      });
    }
    if (statusFilter !== 'all') {
      rows = rows.filter((r) => {
        const status = (r.status || '').toLowerCase();
        const d = parseEta(r.arrival_date ?? r.eta);
        if (statusFilter === 'delayed') return status.includes('delay');
        if (statusFilter === 'upcoming') return d && isFuture(d);
        if (statusFilter === 'soon') {
          if (!d) return false;
          const diff = d.getTime() - Date.now();
          return diff > 0 && diff < 1000 * 60 * 60 * 24 * 3;
        }
        return true;
      });
    }
    rows.sort((a, b) => {
      if (sortFilter === 'az') return (a.consignee || '').localeCompare(b.consignee || '');
      const da = parseEta(a.arrival_date ?? a.eta)?.getTime() ?? 0;
      const db = parseEta(b.arrival_date ?? b.eta)?.getTime() ?? 0;
      return sortFilter === 'latest' ? db - da : da - db;
    });
    return rows;
  }, [containers, consigneeSearch, containerSearch, dateFilter, sortFilter, statusFilter]);

  // group by consignee
  const consignees = useMemo(() => {
    const map = new Map<string, { name: string; total: number; rows: ContainerRow[] }>();
    for (const r of filteredContainers) {
      const name = (r.consignee || 'Unassigned').trim() || 'Unassigned';
      const entry = map.get(name) ?? { name, total: 0, rows: [] as ContainerRow[] };
      entry.total += 1;
      entry.rows.push(r);
      map.set(name, entry);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredContainers]);

  // uploads grouped by timestamp
  const uploads = useMemo(() => {
    const map = new Map<string, { stamp: string; count: number; consignees: Set<string> }>();
    for (const r of containers) {
      const key = r.upload_timestamp;
      const entry = map.get(key) ?? { stamp: key, count: 0, consignees: new Set<string>() };
      entry.count += 1;
      if (r.consignee) entry.consignees.add(r.consignee);
      map.set(key, entry);
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.stamp).getTime() - new Date(a.stamp).getTime(),
    );
  }, [containers]);

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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              You don't have permission to view this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <Header />

      {/* Sticky summary */}
      <div className="sticky top-[64px] z-30 backdrop-blur-xl bg-background/80 border-b border-border/40">
        <div className="container mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button asChild variant="ghost" size="icon" className="shrink-0">
              <Link to="/admin" aria-label="Back to admin dashboard">
                <ArrowLeft className="w-4 h-4" />
              </Link>
            </Button>
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
              <UserIcon className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-lg font-bold font-display truncate">
                {displayName}
              </h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground truncate">
                {displayEmail}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="gap-1.5 border-status-arrived/30 bg-status-arrived/5 text-status-arrived shrink-0"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-status-arrived opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-status-arrived" />
            </span>
            <span className="text-[10px] sm:text-xs font-semibold">LIVE</span>
          </Badge>
        </div>
      </div>

      <main className="container mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-6">
        {/* Profile card */}
        <motion.section {...fadeUp} transition={{ duration: 0.4 }}>
          <Card className="border-border/60 bg-card/60 backdrop-blur-xl overflow-hidden">
            <div className="h-20 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/10" />
            <CardContent className="p-4 sm:p-6 -mt-12">
              <div className="flex flex-col sm:flex-row sm:items-end gap-4">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center text-2xl font-bold font-display text-primary-foreground border-4 border-card shadow-lg shrink-0">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold font-display truncate">
                    {displayName}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {displayEmail}
                    </span>
                    <span className="font-mono truncate">ID: {userId?.slice(0, 8)}…</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
                <div className="rounded-xl bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Joined</p>
                  <p className="text-sm font-semibold mt-0.5">
                    {profile?.created_at
                      ? new Date(profile.created_at).toLocaleDateString()
                      : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Last active</p>
                  <p className="text-sm font-semibold mt-0.5">
                    {lastActive ? formatDistanceToNow(lastActive, { addSuffix: true }) : '—'}
                  </p>
                </div>
                <div className="rounded-xl bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Uploads</p>
                  <p className="text-sm font-semibold mt-0.5">{stats.uploads}</p>
                </div>
                <div className="rounded-xl bg-muted/30 p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Containers</p>
                  <p className="text-sm font-semibold mt-0.5">{stats.total}</p>
                </div>
                <div className="rounded-xl bg-muted/30 p-3 col-span-2 md:col-span-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Consignees</p>
                  <p className="text-sm font-semibold mt-0.5">{stats.consignees}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.section>

        {/* Bento stats */}
        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <BentoStat icon={Box} label="Total Containers" value={stats.total} accent="bg-primary" />
          <BentoStat icon={Truck} label="Today" value={stats.today} accent="bg-accent" />
          <BentoStat icon={CalendarClock} label="Upcoming" value={stats.upcoming} accent="bg-status-in-transit" />
          <BentoStat icon={Clock} label="Delayed" value={stats.delayed} accent="bg-destructive" />
          <BentoStat icon={Users} label="Consignees" value={stats.consignees} accent="bg-primary" />
          <BentoStat
            icon={Upload}
            label="Latest Upload"
            value={
              stats.latestUpload
                ? formatDistanceToNow(stats.latestUpload, { addSuffix: true })
                : '—'
            }
            accent="bg-accent"
          />
        </section>

        {/* Filters */}
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={consigneeSearch}
              onChange={(e) => setConsigneeSearch(e.target.value)}
              placeholder="Search consignee…"
              className="pl-9"
            />
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={containerSearch}
              onChange={(e) => setContainerSearch(e.target.value)}
              placeholder="Search container…"
              className="pl-9"
            />
          </div>
          <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as DateFilter)}>
            <SelectTrigger><SelectValue placeholder="Arrival date" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All dates</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">This week</SelectItem>
              <SelectItem value="month">This month</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortFilter} onValueChange={(v) => setSortFilter(v as SortFilter)}>
            <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">Latest arrival</SelectItem>
              <SelectItem value="oldest">Oldest arrival</SelectItem>
              <SelectItem value="az">Consignee A–Z</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="soon">Arriving Soon</SelectItem>
              <SelectItem value="delayed">Delayed</SelectItem>
              <SelectItem value="upcoming">Upcoming</SelectItem>
            </SelectContent>
          </Select>
        </section>

        {/* Consignee bento grid */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-bold font-display">Consignees</h2>
            <Badge variant="outline" className="shrink-0">{consignees.length} total</Badge>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : consignees.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center text-sm text-muted-foreground">
                No consignees match the current filters.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {consignees.map((c, i) => {
                const etas = c.rows
                  .map((r) => parseEta(r.arrival_date ?? r.eta)?.getTime())
                  .filter((n): n is number => typeof n === 'number');
                const earliest = etas.length ? new Date(Math.min(...etas)) : null;
                const latest = etas.length ? new Date(Math.max(...etas)) : null;
                return (
                  <motion.button
                    key={c.name}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
                    whileHover={{ y: -3 }}
                    onClick={() => setSelectedConsignee(c.name)}
                    className="text-left"
                  >
                    <Card className="border-border/60 bg-card/60 backdrop-blur-xl hover:border-primary/40 hover:shadow-lg transition-all h-full">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold truncate">{c.name}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {c.total} containers
                            </p>
                          </div>
                          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary/15 to-accent/15 flex items-center justify-center shrink-0">
                            <Ship className="w-4 h-4 text-primary" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-primary/5 p-2">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Earliest
                            </p>
                            <p className="text-xs font-bold text-primary mt-0.5">
                              {earliest ? earliest.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'}
                            </p>
                          </div>
                          <div className="rounded-lg bg-accent/5 p-2">
                            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              Latest
                            </p>
                            <p className="text-xs font-bold text-accent mt-0.5">
                              {latest ? latest.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : '—'}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.button>
                );
              })}
            </div>
          )}
        </section>

        {/* Live activity + Upload history */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
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
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      Waiting for activity…
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {activity.map((e) => (
                        <motion.li
                          key={e.id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex items-start gap-3 text-sm"
                        >
                          <span
                            className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                              e.type === 'INSERT'
                                ? 'bg-status-arrived'
                                : e.type === 'UPDATE'
                                  ? 'bg-primary'
                                  : 'bg-destructive'
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="leading-tight truncate">
                              {displayName} {e.message.toLowerCase()}
                            </p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">
                              {formatDistanceToNow(e.at, { addSuffix: true })}
                            </p>
                          </div>
                        </motion.li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.05 }}>
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <Upload className="w-4 h-4 text-primary" />
                  Upload History
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[320px] px-6 pb-4">
                  {uploads.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">
                      No uploads yet.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {uploads.map((u, idx) => (
                        <li
                          key={u.stamp + idx}
                          className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate">
                              Excel upload #{uploads.length - idx}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatDistanceToNow(new Date(u.stamp), { addSuffix: true })}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-semibold">{u.count} containers</p>
                            <p className="text-[11px] text-muted-foreground">
                              {u.consignees.size} consignees
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>
        </section>
      </main>

      {/* Consignee detail */}
      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedConsignee(null)}
      >
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ship className="w-4 h-4 text-primary" />
              {selected?.name}
              <Badge variant="outline" className="ml-2">
                {selected?.total} containers
              </Badge>
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
                      className="p-3 rounded-lg border border-border/50 bg-muted/20 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-mono font-semibold text-sm truncate">
                          {r.container_number}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {r.vessel_name || '—'} · {r.current_location || '—'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Badge variant="outline" className="text-[10px]">
                          {r.status}
                        </Badge>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {parseEta(r.arrival_date ?? r.eta)?.toLocaleDateString() || '—'}
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
