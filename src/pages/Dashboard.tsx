import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Activity, Box, CalendarClock, Clock, Ship, Truck, Users, TrendingUp,
  ArrowRight, Sparkles, ChevronRight,
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
  user_id: string;
  updated_at: string;
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
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
};

const formatDate = (s: string | null) => {
  const d = parseIso(s);
  if (!d) return '—';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

function BentoStat({
  icon: Icon,
  label,
  value,
  accent,
  delay = 0,
  onClick,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  accent: string;
  delay?: number;
  onClick?: () => void;
  hint?: string;
}) {
  return (
    <motion.button
      {...fadeUp}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="text-left w-full group"
    >
      <Card className="relative overflow-hidden border-border/60 bg-card/60 backdrop-blur-xl hover:shadow-lg hover:border-primary/40 transition-all">
        <div className={`absolute inset-x-0 top-0 h-1 ${accent}`} />
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground font-medium">
                {label}
              </p>
              <p className="text-2xl sm:text-3xl font-bold font-display mt-1 truncate">{value}</p>
              {hint && <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 truncate">{hint}</p>}
            </div>
            <div className={`shrink-0 w-9 h-9 sm:w-10 sm:h-10 rounded-xl ${accent} bg-opacity-15 flex items-center justify-center`}>
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.button>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase
        .from('tracked_containers')
        .select('id, container_number, consignee, arrival_date, eta, status, user_id, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
      if (cancelled) return;
      setRows((data as Row[]) ?? []);
      setLoading(false);
    };
    load();
    const channel = supabase
      .channel(`dash-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tracked_containers', filter: `user_id=eq.${user.id}` },
        load,
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user]);

  const stats = useMemo(() => {
    let today = 0, upcoming = 0, delayed = 0;
    const consigneeSet = new Set<string>();
    const isoDates: string[] = [];
    rows.forEach((r) => {
      if (r.consignee) consigneeSet.add(r.consignee.trim());
      const days = daysFromToday(parseIso(r.arrival_date ?? r.eta));
      if (days === 0) today++;
      else if (days !== null && days > 0) upcoming++;
      else if (days !== null && days < 0) delayed++;
      const iso = (r.arrival_date ?? r.eta)?.slice(0, 10);
      if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) isoDates.push(iso);
    });
    isoDates.sort();
    return {
      total: rows.length,
      today, upcoming, delayed,
      consignees: consigneeSet.size,
      latest: isoDates[isoDates.length - 1] ?? null,
      earliest: isoDates[0] ?? null,
    };
  }, [rows]);

  const consigneeGroups = useMemo(() => {
    const map = new Map<string, Row[]>();
    rows.forEach((r) => {
      const name = (r.consignee || 'Unassigned').trim() || 'Unassigned';
      const list = map.get(name) ?? [];
      list.push(r);
      map.set(name, list);
    });
    return Array.from(map.entries())
      .map(([name, list]) => ({ name, count: list.length, rows: list }))
      .sort((a, b) => b.count - a.count);
  }, [rows]);

  const todaysArrivals = useMemo(
    () => rows.filter((r) => daysFromToday(parseIso(r.arrival_date ?? r.eta)) === 0),
    [rows],
  );

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto p-6 space-y-4">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const goOTW = () => navigate('/invoice-generator');

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/30">
      <Header />

      <div className="sticky top-[64px] z-30 backdrop-blur-xl bg-background/80 border-b border-border/40">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
              <Activity className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-bold font-display truncate">Dashboard</h1>
              <p className="text-[10px] sm:text-xs text-muted-foreground -mt-0.5 truncate">
                Your live shipment overview
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
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <motion.div {...fadeUp} transition={{ duration: 0.4 }}>
            <Card className="border-border/60 bg-card/60 backdrop-blur-xl">
              <CardContent className="p-8 sm:p-12 text-center space-y-4">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center">
                  <Sparkles className="w-8 h-8 text-primary" />
                </div>
                <div>
                  <h2 className="text-xl font-bold font-display">No shipments yet</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Upload an Excel file on the On The Way page to populate your dashboard.
                  </p>
                </div>
                <Link to="/invoice-generator">
                  <Button className="gap-2 rounded-xl">
                    <Truck className="w-4 h-4" /> Go to On The Way
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          <>
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <BentoStat icon={Box} label="Total Containers" value={stats.total} accent="bg-primary" delay={0} onClick={goOTW} />
              <BentoStat icon={Truck} label="Arriving Today" value={stats.today} accent="bg-accent" delay={0.05} onClick={goOTW} />
              <BentoStat icon={CalendarClock} label="Upcoming" value={stats.upcoming} accent="bg-status-in-transit" delay={0.1} onClick={goOTW} />
              <BentoStat icon={Clock} label="Delayed" value={stats.delayed} accent="bg-destructive" delay={0.15} onClick={goOTW} />
              <BentoStat icon={Ship} label="Consignees" value={stats.consignees} accent="bg-primary" delay={0.2} onClick={goOTW} />
              <BentoStat icon={CalendarClock} label="Latest ETA" value={stats.latest ? formatDate(stats.latest) : '—'} accent="bg-accent" delay={0.25} hint={stats.earliest ? `from ${formatDate(stats.earliest)}` : undefined} onClick={goOTW} />
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <motion.div {...fadeUp} transition={{ duration: 0.4 }} className="lg:col-span-2">
                <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
                  <CardHeader className="pb-3 flex-row items-center justify-between gap-2 space-y-0">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-primary" />
                      Today's Arrivals
                    </CardTitle>
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/15 border-0">
                      {todaysArrivals.length} containers
                    </Badge>
                  </CardHeader>
                  <CardContent>
                    {todaysArrivals.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        No arrivals scheduled for today.
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {todaysArrivals.slice(0, 8).map((r) => (
                          <button
                            key={r.id}
                            onClick={goOTW}
                            className="group text-left p-3 rounded-xl border border-border/50 bg-gradient-to-br from-muted/40 to-transparent hover:from-primary/5 hover:border-primary/30 transition-all"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-sm font-semibold truncate">{r.container_number}</span>
                              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{r.consignee || 'Unassigned'}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.05 }}>
                <Card className="border-border/60 bg-card/60 backdrop-blur-xl h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" /> Top Consignees
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {consigneeGroups.slice(0, 6).map((g) => (
                      <button
                        key={g.name}
                        onClick={goOTW}
                        className="group w-full text-left p-2.5 rounded-xl border border-border/50 bg-gradient-to-br from-muted/30 to-transparent hover:from-primary/5 hover:border-primary/30 transition-all flex items-center justify-between gap-2"
                      >
                        <span className="font-medium text-sm truncate">{g.name}</span>
                        <Badge variant="outline" className="shrink-0 border-primary/30 bg-primary/5 text-primary text-[10px]">
                          {g.count}
                        </Badge>
                      </button>
                    ))}
                    {consigneeGroups.length === 0 && (
                      <p className="text-sm text-muted-foreground py-4 text-center">No consignees yet.</p>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            </section>

            <motion.div {...fadeUp} transition={{ duration: 0.4, delay: 0.1 }}>
              <Card className="border-border/60 bg-card/60 backdrop-blur-xl">
                <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold font-display">Drill down into every shipment</h3>
                    <p className="text-sm text-muted-foreground">
                      Browse consignees, ETAs and container details on the On The Way page.
                    </p>
                  </div>
                  <Link to="/invoice-generator" className="shrink-0">
                    <Button className="rounded-xl gap-2">
                      Open On The Way <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </motion.div>
          </>
        )}
      </main>
    </div>
  );
}
