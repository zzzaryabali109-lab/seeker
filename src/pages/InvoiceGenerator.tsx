import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Upload, FileSpreadsheet, Loader2, Search, ArrowLeft,
  Users, Package, CalendarClock, CalendarDays, ArrowUpDown,
  CloudUpload, Container as ContainerIcon, ChevronRight, Sparkles, Ship,
  TrendingUp, AlertTriangle, Clock, Sun, Columns3, Database, Hash, Tag,
  Anchor, Compass,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { replaceUserContainers } from '@/services/containerDbService';
import { supabase } from '@/integrations/supabase/client';
import type { ContainerData } from '@/types/container';

/* ───────────── Types ───────────── */

type Role =
  | 'consignee' | 'container' | 'arrival' | 'status' | 'shipping'
  | 'bl' | 'do' | 'port' | 'vessel' | 'voyage' | 'other';

interface ShipmentRow {
  id: string;
  /** Every column from the source file, keyed by header. Includes consignee/container/arrival. */
  values: Record<string, string>;
  container: string;
  consignee: string;
  arrivalDate: string; // ISO when parseable
  arrivalRaw: string;
}

interface DetectedColumn {
  header: string;
  role: Role;
  filled: number;
  distinct: number;
  /** True when the column is a good drill-down target (categorical-ish). */
  groupable: boolean;
  /** All unique values with counts, sorted descending. */
  groups: { value: string; count: number }[];
}

type View = 'dashboard' | 'column' | 'value';

/* ───────────── Header classification ───────────── */

const CONSIGNEE_KEYS = ['consignee', 'consignee name', 'customer', 'client', 'receiver', 'importer', 'buyer', 'notify party', 'notify'];
const CONTAINER_KEYS = ['container', 'container no', 'container number', 'container#', 'cntr', 'cont', 'box', 'equipment', 'equipment no', 'unit', 'unit no'];
const ARRIVAL_KEYS = ['arrival', 'arrival date', 'eta', 'eta date', 'estimated arrival', 'date of arrival', 'ata'];
const STATUS_KEYS = ['status', 'shipment status', 'container status', 'state'];
const SHIPPING_KEYS = ['shipping line', 'carrier', 'line', 'shipping co', 'shipping company', 'scac'];
const BL_KEYS = ['bl', 'bl no', 'bl number', 'bill of lading', 'mbl', 'hbl', 'mawb', 'awb'];
const DO_KEYS = ['do', 'do status', 'delivery order'];
const PORT_KEYS = ['port', 'destination port', 'pod', 'discharge port', 'pol', 'load port', 'terminal'];
const VESSEL_KEYS = ['vessel', 'vessel name', 'ship'];
const VOYAGE_KEYS = ['voyage', 'voyage no', 'voyage number'];

const norm = (s: string) => s.toLowerCase().trim().replace(/[\s_\-./#]+/g, ' ').replace(/\s+/g, ' ');
const matchHeader = (header: string, candidates: string[]) => {
  const n = norm(header);
  return candidates.some((c) => n === c || n.includes(c) || c.includes(n));
};
const classifyHeader = (header: string): Role => {
  if (matchHeader(header, CONTAINER_KEYS)) return 'container';
  if (matchHeader(header, CONSIGNEE_KEYS)) return 'consignee';
  if (matchHeader(header, ARRIVAL_KEYS)) return 'arrival';
  if (matchHeader(header, STATUS_KEYS)) return 'status';
  if (matchHeader(header, SHIPPING_KEYS)) return 'shipping';
  if (matchHeader(header, BL_KEYS)) return 'bl';
  if (matchHeader(header, DO_KEYS)) return 'do';
  if (matchHeader(header, PORT_KEYS)) return 'port';
  if (matchHeader(header, VESSEL_KEYS)) return 'vessel';
  if (matchHeader(header, VOYAGE_KEYS)) return 'voyage';
  return 'other';
};

const ROLE_ICON: Record<Role, React.ComponentType<{ className?: string }>> = {
  container: Package, consignee: Users, arrival: CalendarDays, status: Tag,
  shipping: Ship, bl: FileSpreadsheet, do: FileSpreadsheet, port: Anchor, vessel: Ship,
  voyage: Compass, other: Columns3,
};
type Tone = 'primary' | 'violet' | 'amber' | 'emerald' | 'red' | 'muted';
const ROLE_TONE: Record<Role, Tone> = {
  container: 'primary', consignee: 'violet', arrival: 'emerald', status: 'amber',
  shipping: 'primary', bl: 'muted', do: 'muted', port: 'violet', vessel: 'primary',
  voyage: 'muted', other: 'muted',
};

/* ───────────── Value helpers ───────────── */

const cleanContainer = (raw: string): string => {
  if (!raw) return '';
  const compact = raw.toString().toUpperCase().replace(/[\s\-_./\\]/g, '');
  if (!compact) return '';
  const iso = compact.match(/([A-Z]{4}\d{7})/);
  if (iso) return iso[1];
  if (/^[A-Z0-9]{6,}$/.test(compact)) return compact;
  return '';
};
const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).trim();
const cellToString = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (Array.isArray(obj.richText)) return (obj.richText as { text: string }[]).map((r) => r.text ?? '').join('');
    if (typeof obj.text === 'string') return obj.text;
    if (obj.result !== undefined) return cellToString(obj.result);
    if (typeof obj.hyperlink === 'string') return obj.hyperlink;
    if (typeof obj.formula === 'string') return '';
  }
  return String(v);
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const toIso = (y: number, m: number, d: number): string | null => {
  if (!y || !m || !d) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};
const parseDate = (raw: string): { iso: string; display: string } => {
  if (!raw) return { iso: '', display: '' };
  const s = raw.trim();
  if (!s) return { iso: '', display: '' };
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) { const iso = toIso(+isoMatch[1], +isoMatch[2], +isoMatch[3]); if (iso) return { iso, display: iso }; }
  if (/^\d{1,6}(\.\d+)?$/.test(s)) {
    const num = Number(s);
    if (num > 59 && num < 100000) {
      const date = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
      if (!isNaN(date.getTime())) {
        const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
        return { iso, display: iso };
      }
    }
  }
  const monMatch = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+(\d{2,4})$/);
  if (monMatch) { const m = MONTHS[monMatch[2].toLowerCase()]; const iso = m ? toIso(+monMatch[3], m, +monMatch[1]) : null; if (iso) return { iso, display: iso }; }
  const monFirst = s.match(/^([A-Za-z]{3,9})[\s\-/.,]+(\d{1,2})[,\s\-/.]+(\d{2,4})$/);
  if (monFirst) { const m = MONTHS[monFirst[1].toLowerCase()]; const iso = m ? toIso(+monFirst[3], m, +monFirst[2]) : null; if (iso) return { iso, display: iso }; }
  const num = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (num) {
    const a = +num[1], b = +num[2]; let y = +num[3]; if (y < 100) y += 2000;
    if (a > 12 && b <= 12) { const iso = toIso(y, b, a); if (iso) return { iso, display: iso }; }
    else if (b > 12 && a <= 12) { const iso = toIso(y, a, b); if (iso) return { iso, display: iso }; }
    else { const iso = toIso(y, b, a); if (iso) return { iso, display: iso }; }
  }
  const ymd = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (ymd) { const iso = toIso(+ymd[1], +ymd[2], +ymd[3]); if (iso) return { iso, display: iso }; }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    return { iso, display: iso };
  }
  return { iso: '', display: s };
};
const formatDate = (iso: string): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const daysFromToday = (iso: string): number | null => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(iso); const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - now.getTime()) / 86400000);
};
const statusFromDays = (days: number | null) => {
  if (days === null) return { label: 'Unknown', tone: 'muted' as const };
  if (days < 0) return { label: 'Delayed', tone: 'red' as const };
  if (days === 0) return { label: 'Arriving Today', tone: 'violet' as const };
  if (days <= 3) return { label: 'Arriving Soon', tone: 'amber' as const };
  if (days <= 14) return { label: 'Upcoming', tone: 'emerald' as const };
  return { label: 'On The Way', tone: 'primary' as const };
};

/* ───────────── Smart column analysis ───────────── */

const buildDetectedColumns = (rows: ShipmentRow[]): DetectedColumn[] => {
  if (rows.length === 0) return [];
  const headerOrder: string[] = [];
  const seen = new Set<string>();
  rows.forEach((r) => {
    Object.keys(r.values).forEach((h) => {
      if (!seen.has(h)) { seen.add(h); headerOrder.push(h); }
    });
  });
  return headerOrder
    .map((h) => {
      const role = classifyHeader(h);
      const counts = new Map<string, number>();
      rows.forEach((r) => {
        const raw = (r.values[h] || '').trim();
        if (!raw) return;
        counts.set(raw, (counts.get(raw) || 0) + 1);
      });
      const groups = Array.from(counts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
      const filled = groups.reduce((s, g) => s + g.count, 0);
      const distinct = groups.length;
      // categorical sweet-spot: between 2 and 60 unique values, and fewer than 80% are unique singletons.
      // Container column is unique by nature so it's not "groupable".
      const uniqueRatio = distinct / Math.max(filled, 1);
      const groupable =
        role !== 'container' &&
        distinct >= 2 &&
        distinct <= 80 &&
        uniqueRatio < 0.9;
      return { header: h, role, filled, distinct, groupable, groups };
    })
    .filter((c) => c.filled > 0);
};

const InvoiceGenerator = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<ShipmentRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  const [view, setView] = useState<View>('dashboard');
  const [activeHeader, setActiveHeader] = useState<string | null>(null);
  const [activeValue, setActiveValue] = useState<string | null>(null);

  // column-view filters
  const [groupSearch, setGroupSearch] = useState('');
  const [groupSort, setGroupSort] = useState<'most' | 'az' | 'least'>('most');

  // value-view (containers list) filters
  const [detailSearch, setDetailSearch] = useState('');
  const [detailDateRange, setDetailDateRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [detailSort, setDetailSort] = useState<'newest' | 'oldest' | 'az'>('newest');
  const [detailFilterColumn, setDetailFilterColumn] = useState<string>('__none__');
  const [detailFilterValue, setDetailFilterValue] = useState<string>('__all__');

  const inputRef = useRef<HTMLInputElement>(null);

  /* ── Hydrate from DB ── */
  const hydrate = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('tracked_containers')
      .select('container_number, consignee, arrival_date, eta, extras, shipping_line, vessel_name, voyage_number, destination_port, status')
      .eq('user_id', uid);
    if (!data) return;
    const list: ShipmentRow[] = data.map((d, i) => {
      const extras = (d.extras && typeof d.extras === 'object' ? d.extras : {}) as Record<string, string>;
      const isoArrival = (d.arrival_date || d.eta || '').toString();
      const consignee = titleCase(d.consignee || 'Unknown');
      const container = d.container_number;
      // Reconstruct unified values map. Prefer extras (verbatim source headers); fall back to canonical columns.
      const values: Record<string, string> = { ...extras };
      if (!values['Consignee']) values['Consignee'] = consignee;
      if (!values['Container No']) values['Container No'] = container;
      if (!values['Arrival Date'] && isoArrival) values['Arrival Date'] = isoArrival;
      if (!values['Status'] && d.status && d.status !== 'Pending') values['Status'] = String(d.status);
      if (!values['Shipping Line'] && d.shipping_line) values['Shipping Line'] = String(d.shipping_line);
      if (!values['Vessel'] && d.vessel_name) values['Vessel'] = String(d.vessel_name);
      if (!values['Voyage'] && d.voyage_number) values['Voyage'] = String(d.voyage_number);
      if (!values['Port'] && d.destination_port) values['Port'] = String(d.destination_port);
      return {
        id: `${i}-${container}`,
        values,
        container,
        consignee,
        arrivalDate: isoArrival,
        arrivalRaw: isoArrival,
      };
    });
    setRows(list);
  }, []);

  useEffect(() => {
    if (!user) return;
    hydrate(user.id);
    const channel = supabase
      .channel(`otw-user-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tracked_containers', filter: `user_id=eq.${user.id}` },
        () => hydrate(user.id),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, hydrate]);

  /* ── Upload + AI parse ── */
  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setFileName(file.name);
    try {
      const name = file.name.toLowerCase();
      const buffer = await file.arrayBuffer();
      let records: Record<string, string>[] = [];

      if (name.endsWith('.csv')) {
        const text = new TextDecoder().decode(buffer);
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) throw new Error('CSV has no data rows below the header.');
        const parseLine = (line: string): string[] => {
          const out: string[] = []; let cur = '', inQ = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQ) {
              if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
              else if (ch === '"') inQ = false;
              else cur += ch;
            } else {
              if (ch === '"') inQ = true;
              else if (ch === ',') { out.push(cur.trim()); cur = ''; }
              else cur += ch;
            }
          }
          out.push(cur.trim()); return out;
        };
        const headers = parseLine(lines[0]);
        records = lines.slice(1).map((l) => {
          const cells = parseLine(l);
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { if (h) obj[h] = cells[i] ?? ''; });
          return obj;
        });
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const ExcelJS = await import('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        const ws = wb.worksheets[0];
        if (!ws) throw new Error('No worksheet found in this file.');
        let headerRowIdx = 1, bestCount = 0;
        for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
          const row = ws.getRow(r); let count = 0;
          row.eachCell((cell) => { if (cellToString(cell.value).trim()) count++; });
          if (count > bestCount) { bestCount = count; headerRowIdx = r; }
          if (count >= 3) break;
        }
        const headerRow = ws.getRow(headerRowIdx);
        const headers: string[] = [];
        headerRow.eachCell((cell, col) => {
          const raw = cellToString(cell.value).trim().replace(/\s+/g, ' ');
          headers[col] = raw;
        });
        for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
          const row = ws.getRow(r); const obj: Record<string, string> = {}; let hasData = false;
          headers.forEach((h, col) => {
            if (!h) return;
            const v = cellToString(row.getCell(col).value).trim();
            if (v) hasData = true;
            obj[h] = v;
          });
          if (hasData) records.push(obj);
        }
      } else {
        toast.error('Unsupported file type. Please upload .xlsx, .xls or .csv');
        setIsProcessing(false); return;
      }

      if (records.length === 0) {
        toast.error('File is empty — no data rows found below the header.');
        setIsProcessing(false); return;
      }

      // Classify headers
      const headerKeys = Object.keys(records[0]).filter(Boolean);
      const byRole = new Map<Role, string>();
      headerKeys.forEach((h) => {
        const role = classifyHeader(h);
        if (role !== 'other' && !byRole.has(role)) byRole.set(role, h);
      });
      const containerCol = byRole.get('container');
      const consigneeCol = byRole.get('consignee');
      const arrivalCol = byRole.get('arrival');

      if (!containerCol) {
        toast.error(`Could not find a container column. Detected headers: ${headerKeys.slice(0, 6).join(', ')}${headerKeys.length > 6 ? '…' : ''}`);
        setIsProcessing(false); return;
      }

      const seen = new Set<string>();
      const parsed: ShipmentRow[] = [];
      records.forEach((rec, idx) => {
        const container = cleanContainer(rec[containerCol] || '');
        if (!container) return;
        const consigneeRaw = consigneeCol ? (rec[consigneeCol] || '').toString().trim().replace(/\s+/g, ' ') : '';
        const consignee = consigneeRaw ? titleCase(consigneeRaw) : 'Unknown';
        const arrivalRaw = arrivalCol ? (rec[arrivalCol] || '').toString().trim() : '';
        const { iso, display } = parseDate(arrivalRaw);
        const key = `${consignee.toLowerCase()}|${container}|${iso || display}`;
        if (seen.has(key)) return;
        seen.add(key);
        // Unified values map keyed by the ACTUAL source headers (smart grid drives from this).
        const values: Record<string, string> = {};
        headerKeys.forEach((h) => {
          const v = (rec[h] || '').toString().trim();
          if (!v) return;
          if (h === containerCol) values[h] = container;
          else if (h === consigneeCol) values[h] = consignee;
          else if (h === arrivalCol) values[h] = iso || display;
          else values[h] = v;
        });
        parsed.push({
          id: `${idx}-${container}`, values, container, consignee,
          arrivalDate: iso || display, arrivalRaw: display,
        });
      });

      if (parsed.length === 0) {
        toast.error('No valid container numbers were found. Make sure the container column has values like ABCD1234567.');
        setIsProcessing(false); return;
      }

      if (user) {
        const profileName = (user.user_metadata?.full_name as string | undefined)?.trim() || user.email?.split('@')[0] || 'User';
        const uploadTimestamp = new Date().toISOString();
        const containers: ContainerData[] = parsed.map((row) => ({
          arrivalDate: row.arrivalDate, consignee: row.consignee,
          containerNumber: row.container, shippingLine: '',
          currentLocation: '', vesselName: '', voyageNumber: '',
          eta: row.arrivalDate, lastUpdate: '', status: 'Pending',
          uploadTimestamp, userEmail: user.email ?? undefined, userName: profileName,
        }));
        await replaceUserContainers(
          containers, user.id,
          Object.fromEntries(parsed.map((row) => [
            row.container,
            {
              arrivalDate: row.arrivalDate, consignee: row.consignee,
              uploadTimestamp, userEmail: user.email ?? null, userName: profileName,
              extras: row.values,
            },
          ])),
        );
      }

      toast.success(`Loaded ${parsed.length} shipment${parsed.length === 1 ? '' : 's'} • ${headerKeys.length} columns detected.`);
      setRows(parsed);
      setView('dashboard');
      setActiveHeader(null); setActiveValue(null);
    } catch (err) {
      console.error('[Excel upload]', err);
      const msg = err instanceof Error ? err.message : '';
      if (/zip|signature|corrupt|invalid/i.test(msg)) toast.error('Invalid file — please upload a valid .xlsx, .xls or .csv');
      else if (/network|fetch/i.test(msg)) toast.error('Network error while saving — please try again.');
      else toast.error(msg || 'Could not read this file. Try saving it as .xlsx and re-uploading.');
    } finally {
      setIsProcessing(false);
    }
  }, [user]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files?.[0]; if (file) processFile(file);
  }, [processFile]);

  /* ── Derived ── */
  const detectedColumns = useMemo(() => buildDetectedColumns(rows), [rows]);
  const groupableColumns = useMemo(() => detectedColumns.filter((c) => c.groupable), [detectedColumns]);

  const stats = useMemo(() => {
    let today = 0, upcoming = 0, delayed = 0;
    rows.forEach((r) => {
      const d = daysFromToday(r.arrivalDate); if (d === null) return;
      if (d === 0) today++; else if (d > 0) upcoming++; else delayed++;
    });
    const consignees = new Set(rows.map((r) => r.consignee));
    const allIso = rows.map((r) => r.arrivalDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return {
      totalContainers: rows.length,
      totalConsignees: consignees.size,
      today, upcoming, delayed,
      latest: allIso[allIso.length - 1] || '',
      earliest: allIso[0] || '',
    };
  }, [rows]);

  const activeColumn = useMemo(
    () => detectedColumns.find((c) => c.header === activeHeader) || null,
    [detectedColumns, activeHeader],
  );

  const filteredGroups = useMemo(() => {
    if (!activeColumn) return [];
    let list = [...activeColumn.groups];
    const q = groupSearch.trim().toLowerCase();
    if (q) list = list.filter((g) => g.value.toLowerCase().includes(q));
    list.sort((a, b) => {
      if (groupSort === 'az') return a.value.localeCompare(b.value);
      if (groupSort === 'least') return a.count - b.count;
      return b.count - a.count;
    });
    return list;
  }, [activeColumn, groupSearch, groupSort]);

  const valueRows = useMemo(() => {
    if (!activeHeader || !activeValue) return [];
    let list = rows.filter((r) => (r.values[activeHeader] || '') === activeValue);
    const q = detailSearch.trim().toLowerCase();
    if (q) list = list.filter((r) =>
      r.container.toLowerCase().includes(q) ||
      r.consignee.toLowerCase().includes(q),
    );
    if (detailDateRange !== 'all') {
      list = list.filter((r) => {
        const days = daysFromToday(r.arrivalDate); if (days === null) return false;
        if (detailDateRange === 'today') return days === 0;
        if (detailDateRange === 'week') return days >= 0 && days <= 7;
        if (detailDateRange === 'month') return days >= 0 && days <= 30;
        return true;
      });
    }
    if (detailFilterColumn !== '__none__' && detailFilterValue !== '__all__') {
      list = list.filter((r) => (r.values[detailFilterColumn] || '') === detailFilterValue);
    }
    list.sort((a, b) => {
      if (detailSort === 'az') return a.container.localeCompare(b.container);
      const da = a.arrivalDate || '', db = b.arrivalDate || '';
      if (detailSort === 'newest') return db.localeCompare(da);
      return da.localeCompare(db);
    });
    return list;
  }, [rows, activeHeader, activeValue, detailSearch, detailDateRange, detailSort, detailFilterColumn, detailFilterValue]);

  // Secondary filter options inside value view (other groupable columns)
  const secondaryFilterColumns = useMemo(() => {
    if (!activeHeader) return [];
    return groupableColumns.filter((c) => c.header !== activeHeader);
  }, [groupableColumns, activeHeader]);

  const secondaryFilterValues = useMemo(() => {
    if (detailFilterColumn === '__none__') return [];
    const col = detectedColumns.find((c) => c.header === detailFilterColumn);
    if (!col) return [];
    // Restrict to values present in the current activeValue subset.
    const subset = rows.filter((r) => activeHeader && (r.values[activeHeader] || '') === activeValue);
    const counts = new Map<string, number>();
    subset.forEach((r) => {
      const v = (r.values[detailFilterColumn] || '').trim();
      if (!v) return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([v, c]) => ({ value: v, count: c }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [detailFilterColumn, detectedColumns, rows, activeHeader, activeValue]);

  /* ── Navigation ── */
  const openColumn = (header: string) => {
    setActiveHeader(header); setActiveValue(null);
    setGroupSearch(''); setGroupSort('most');
    setView('column');
  };
  const openValue = (value: string) => {
    setActiveValue(value);
    setDetailSearch(''); setDetailDateRange('all'); setDetailSort('newest');
    setDetailFilterColumn('__none__'); setDetailFilterValue('__all__');
    setView('value');
  };
  const goBack = () => {
    if (view === 'value') { setView('column'); setActiveValue(null); return; }
    if (view === 'column') { setView('dashboard'); setActiveHeader(null); return; }
  };

  const breadcrumb = useMemo(() => {
    const parts: string[] = ['Smart Grid'];
    if (activeHeader) parts.push(activeHeader);
    if (activeValue) parts.push(activeValue);
    return parts.join(' › ');
  }, [activeHeader, activeValue]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 sm:space-y-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
        >
          <div>
            {view !== 'dashboard' && rows.length > 0 && (
              <button
                onClick={goBack}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mb-3">
              <Sparkles className="w-3.5 h-3.5" />
              {view === 'dashboard' && 'Smart AI Grid'}
              {view === 'column' && `${activeColumn?.distinct ?? 0} unique values`}
              {view === 'value' && `${valueRows.length} container${valueRows.length === 1 ? '' : 's'}`}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              {view === 'dashboard' && 'On The Way'}
              {view === 'column' && activeColumn?.header}
              {view === 'value' && activeValue}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm sm:text-base truncate" title={breadcrumb}>
              {view === 'dashboard' && 'Your AI-detected logistics intelligence — every column becomes a grid.'}
              {view !== 'dashboard' && breadcrumb}
            </p>
          </div>
          {rows.length > 0 && (
            <Button variant="outline" onClick={() => inputRef.current?.click()} className="gap-2 w-full sm:w-auto">
              <Upload className="w-4 h-4" /> Upload new file
            </Button>
          )}
        </motion.div>

        {/* Upload */}
        {rows.length === 0 && (
          <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'relative cursor-pointer rounded-3xl border-2 border-dashed p-12 sm:p-16 text-center transition-all',
                'bg-gradient-to-br from-card to-primary/5',
                isDragging ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-border hover:border-primary/50',
              )}
            >
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                  {isProcessing
                    ? <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    : <CloudUpload className="w-10 h-10 text-primary" />}
                </div>
                <div>
                  <h3 className="text-xl font-semibold">
                    {isProcessing ? 'Processing your shipments…' : 'Drop your shipments file here'}
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Supports .xlsx, .xls and .csv — AI auto-detects every column and builds smart drill-down grids.
                  </p>
                </div>
                {!isProcessing && (
                  <Button className="gap-2 mt-2">
                    <FileSpreadsheet className="w-4 h-4" /> Choose file
                  </Button>
                )}
                {fileName && !isProcessing && (
                  <p className="text-xs text-muted-foreground">Last file: {fileName}</p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        <input
          ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]; if (file) processFile(file);
            e.target.value = '';
          }}
        />

        {/* DASHBOARD — Overview stats + Smart Column Grid */}
        {rows.length > 0 && view === 'dashboard' && (
          <>
            <motion.div
              key="dash" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 auto-rows-[minmax(0,_1fr)] gap-3 sm:gap-4"
            >
              <BentoCard
                className="col-span-2 sm:col-span-3 lg:col-span-3 lg:row-span-2"
                tone="primary" icon={Package} label="Total Containers"
                value={stats.totalContainers}
                hint={`${stats.totalConsignees} consignees • ${detectedColumns.length} columns detected`}
                size="hero"
              />
              <BentoCard tone="violet" icon={Users} label="Consignees" value={stats.totalConsignees} />
              <BentoCard tone="amber" icon={Sun} label="Today" value={stats.today} hint="arrivals" />
              <BentoCard tone="emerald" icon={TrendingUp} label="Upcoming" value={stats.upcoming} hint="ahead" />
              <BentoCard tone="red" icon={AlertTriangle} label="Delayed" value={stats.delayed} hint="past ETA" />
              <BentoCard
                className="col-span-2 sm:col-span-3 lg:col-span-3"
                tone="muted" icon={CalendarDays} label="Latest ETA"
                value={stats.latest ? formatDate(stats.latest) : '—'}
                hint={stats.earliest ? `Earliest ${formatDate(stats.earliest)}` : undefined}
              />
              <BentoCard
                className="col-span-2 sm:col-span-3 lg:col-span-3"
                tone="primary" icon={Clock} label="Next 7 days"
                value={rows.filter((r) => { const d = daysFromToday(r.arrivalDate); return d !== null && d >= 0 && d <= 7; }).length}
                hint="containers arriving"
              />
            </motion.div>

            {/* SMART COLUMN GRID — every column from the file becomes a drillable bento */}
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Smart Column Grid
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {detectedColumns.length} column{detectedColumns.length === 1 ? '' : 's'} • {groupableColumns.length} drillable
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4">
                {detectedColumns.map((col) => (
                  <BentoCard
                    key={col.header}
                    tone={ROLE_TONE[col.role]}
                    icon={ROLE_ICON[col.role]}
                    label={col.header}
                    value={col.distinct}
                    hint={
                      col.groupable
                        ? `${col.distinct} unique • ${col.filled} entries`
                        : `${col.filled} entries`
                    }
                    onClick={col.groupable ? () => openColumn(col.header) : undefined}
                    cta={col.groupable ? 'Drill in' : undefined}
                  />
                ))}
              </div>
              {groupableColumns.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  No categorical columns detected yet — upload an Excel with columns like Port, Status, Consignee or Shipping Line to enable drill-downs.
                </p>
              )}
            </motion.div>
          </>
        )}

        {/* COLUMN VIEW — show unique values inside the selected column */}
        {rows.length > 0 && view === 'column' && activeColumn && (
          <motion.div
            key="col" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="relative sm:col-span-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={`Search ${activeColumn.header.toLowerCase()}…`}
                  value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} className="pl-9 h-10"
                />
              </div>
              <Select value={groupSort} onValueChange={(v) => setGroupSort(v as typeof groupSort)}>
                <SelectTrigger className="h-10">
                  <ArrowUpDown className="w-3.5 h-3.5 mr-1" /><SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="most">Most containers</SelectItem>
                  <SelectItem value="least">Least containers</SelectItem>
                  <SelectItem value="az">A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">
              Showing <span className="font-semibold text-foreground">{filteredGroups.length}</span> of {activeColumn.distinct} {activeColumn.header.toLowerCase()} values
            </p>

            <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
              <AnimatePresence mode="popLayout">
                {filteredGroups.map((g, i) => {
                  const Icon = ROLE_ICON[activeColumn.role];
                  return (
                    <motion.div
                      key={g.value} layout
                      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 12 }} transition={{ delay: Math.min(i * 0.02, 0.3) }}
                      whileHover={{ y: -4 }} onClick={() => openValue(g.value)} className="group cursor-pointer"
                    >
                      <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-card via-card to-primary/5 hover:shadow-xl hover:border-primary/40 transition-all duration-300 h-full">
                        <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-primary/10 blur-2xl group-hover:bg-primary/20 transition-colors" />
                        <CardContent className="p-5 relative">
                          <div className="flex items-start justify-between mb-4">
                            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
                              <Icon className="w-5 h-5" />
                            </div>
                            <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                          </div>
                          <h3 className="font-semibold text-base leading-tight line-clamp-2 mb-3" title={g.value}>
                            {g.value}
                          </h3>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-bold tracking-tight">{g.count}</span>
                            <span className="text-xs text-muted-foreground">container{g.count === 1 ? '' : 's'}</span>
                          </div>
                          <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                            <span className="text-muted-foreground inline-flex items-center gap-1.5">
                              <Hash className="w-3.5 h-3.5" /> in {activeColumn.header}
                            </span>
                            <span className="font-medium text-primary">Open →</span>
                          </div>
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>

            {filteredGroups.length === 0 && (
              <div className="text-center py-16 text-muted-foreground text-sm">
                No values match the current search.
              </div>
            )}
          </motion.div>
        )}

        {/* VALUE VIEW — containers belonging to the selected value, with smart filters */}
        {rows.length > 0 && view === 'value' && activeHeader && activeValue && (
          <motion.div
            key="val" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search container…"
                  value={detailSearch} onChange={(e) => setDetailSearch(e.target.value)} className="pl-9 h-10"
                />
              </div>
              <Select value={detailDateRange} onValueChange={(v) => setDetailDateRange(v as typeof detailDateRange)}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dates</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">This week</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={detailFilterColumn}
                onValueChange={(v) => { setDetailFilterColumn(v); setDetailFilterValue('__all__'); }}
              >
                <SelectTrigger className="h-10"><SelectValue placeholder="Filter by…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No extra filter</SelectItem>
                  {secondaryFilterColumns.map((c) => (
                    <SelectItem key={c.header} value={c.header}>Filter by {c.header}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={detailSort} onValueChange={(v) => setDetailSort(v as typeof detailSort)}>
                <SelectTrigger className="h-10">
                  <ArrowUpDown className="w-3.5 h-3.5 mr-1" /><SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest arrival</SelectItem>
                  <SelectItem value="oldest">Oldest arrival</SelectItem>
                  <SelectItem value="az">Container A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {detailFilterColumn !== '__none__' && secondaryFilterValues.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setDetailFilterValue('__all__')}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                    detailFilterValue === '__all__'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:bg-muted border-border',
                  )}
                >
                  All ({secondaryFilterValues.reduce((s, v) => s + v.count, 0)})
                </button>
                {secondaryFilterValues.map((v) => (
                  <button
                    key={v.value}
                    onClick={() => setDetailFilterValue(v.value)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors max-w-[18rem] truncate',
                      detailFilterValue === v.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card hover:bg-muted border-border',
                    )}
                    title={v.value}
                  >
                    {v.value} ({v.count})
                  </button>
                ))}
              </div>
            )}

            {valueRows.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">
                No containers match the current filters.
              </div>
            ) : (
              <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence mode="popLayout">
                  {valueRows.map((r, i) => (
                    <ContainerCard key={r.id} row={r} delay={Math.min(i * 0.02, 0.3)} />
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
};

/* ───────────── Bento card ───────────── */

interface BentoCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number | string; hint?: string;
  tone: Tone; size?: 'normal' | 'hero';
  className?: string; onClick?: () => void; cta?: string;
}
const TONE: Record<Tone, { grad: string; chip: string; ring: string; glow: string }> = {
  primary: { grad: 'from-primary/15 via-card to-card', chip: 'bg-primary/15 text-primary', ring: 'hover:border-primary/40', glow: 'bg-primary/20' },
  violet:  { grad: 'from-violet-500/15 via-card to-card', chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', ring: 'hover:border-violet-500/40', glow: 'bg-violet-500/20' },
  amber:   { grad: 'from-amber-500/15 via-card to-card', chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', ring: 'hover:border-amber-500/40', glow: 'bg-amber-500/20' },
  emerald: { grad: 'from-emerald-500/15 via-card to-card', chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', ring: 'hover:border-emerald-500/40', glow: 'bg-emerald-500/20' },
  red:     { grad: 'from-red-500/15 via-card to-card', chip: 'bg-red-500/15 text-red-600 dark:text-red-400', ring: 'hover:border-red-500/40', glow: 'bg-red-500/20' },
  muted:   { grad: 'from-muted/30 via-card to-card', chip: 'bg-muted text-muted-foreground', ring: 'hover:border-border', glow: 'bg-muted-foreground/10' },
};
const BentoCard = ({ icon: Icon, label, value, hint, tone, size = 'normal', className, onClick, cta }: BentoCardProps) => {
  const t = TONE[tone]; const interactive = !!onClick;
  return (
    <motion.div whileHover={interactive ? { y: -3 } : undefined} onClick={onClick}
      className={cn('group', interactive && 'cursor-pointer', className)}>
      <Card className={cn(
        'relative overflow-hidden border-border/60 bg-gradient-to-br h-full transition-all duration-300',
        t.grad, t.ring, interactive && 'hover:shadow-xl',
      )}>
        <div className={cn('absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl opacity-70 group-hover:opacity-100 transition-opacity', t.glow)} />
        <CardContent className={cn('relative h-full flex flex-col', size === 'hero' ? 'p-6 sm:p-7' : 'p-4 sm:p-5')}>
          <div className="flex items-start justify-between mb-3">
            <div className={cn('rounded-xl flex items-center justify-center', t.chip, size === 'hero' ? 'w-12 h-12' : 'w-10 h-10')}>
              <Icon className={cn(size === 'hero' ? 'w-6 h-6' : 'w-5 h-5')} />
            </div>
            {interactive && (
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
            )}
          </div>
          <p className={cn('font-medium text-muted-foreground uppercase tracking-wide truncate', size === 'hero' ? 'text-xs' : 'text-[11px]')} title={label}>{label}</p>
          <p className={cn('font-bold tracking-tight mt-1', size === 'hero' ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl')}>{value}</p>
          {hint && <p className={cn('text-muted-foreground mt-1', size === 'hero' ? 'text-sm' : 'text-xs')}>{hint}</p>}
          {cta && (
            <div className="mt-auto pt-3">
              <span className="text-xs font-medium text-foreground/80 inline-flex items-center gap-1 group-hover:text-primary transition-colors">
                {cta} <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

/* ───────────── Container card ───────────── */

const ContainerCard = ({ row, delay }: { row: ShipmentRow; delay: number }) => {
  const days = daysFromToday(row.arrivalDate);
  const status = statusFromDays(days);
  const tone = TONE[status.tone];
  const progress = days === null ? 0 : days < 0 ? 100 : Math.max(0, Math.min(100, 100 - (days / 30) * 100));
  const etaLabel =
    days === null ? '—' :
    days < 0 ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue` :
    days === 0 ? 'Arriving today' :
    `${days} day${days === 1 ? '' : 's'} remaining`;

  return (
    <motion.div layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }} transition={{ delay }} whileHover={{ y: -3 }}>
      <Card className={cn(
        'relative overflow-hidden border-border/60 bg-gradient-to-br h-full hover:shadow-xl transition-all duration-300',
        tone.grad, tone.ring,
      )}>
        <div className={cn('absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-70', tone.glow)} />
        <CardContent className="p-5 relative">
          <div className="flex items-start justify-between mb-4">
            <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center', tone.chip)}>
              <ContainerIcon className="w-5 h-5" />
            </div>
            <Badge className={cn('border-0 font-medium', tone.chip)}>{status.label}</Badge>
          </div>
          <p className="font-mono font-semibold text-base tracking-tight truncate">{row.container}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5" title={row.consignee}>{row.consignee}</p>
          <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border/60">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Arrival</p>
              <p className="text-sm font-semibold mt-0.5">{formatDate(row.arrivalDate) || row.arrivalRaw || '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">ETA</p>
              <p className="text-sm font-semibold mt-0.5">{etaLabel}</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${progress}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={cn('h-full rounded-full', tone.chip.split(' ')[0])}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default InvoiceGenerator;

/* Unused import shim — keep CalendarClock referenced for future use without breaking lint. */
void CalendarClock;
