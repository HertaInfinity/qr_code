import { useCallback, useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import * as XLSX from 'xlsx';
import {
  ThemeProvider, createTheme, CssBaseline, AppBar, Toolbar, Typography, IconButton, Avatar, Menu, MenuItem,
  Box, Container, Card, CardActionArea, CardContent, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Tabs, Tab, ToggleButton, ToggleButtonGroup, Grid, List, ListItem, ListItemAvatar, ListItemText,
  Chip, Table, TableHead, TableBody, TableRow, TableCell, TableContainer, CircularProgress, Snackbar, Alert,
  Paper, Stack
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import { sb, api, post, deviceId, colorFor } from './lib';

const theme = createTheme({
  palette: { primary: { main: '#1a73e8' }, background: { default: '#f8f9fa' }, text: { primary: '#202124', secondary: '#5f6368' } },
  shape: { borderRadius: 8 },
  typography: { fontFamily: 'Roboto, system-ui, sans-serif', button: { textTransform: 'none', fontWeight: 500 } },
  components: { MuiCard: { styleOverrides: { root: { border: '1px solid #dadce0', boxShadow: 'none' } } } }
});
const initials = (n = '') => n.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
const fmtDate = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString([], { day: '2-digit', month: 'short' });
const pattern = 'radial-gradient(circle at 88% 15%, rgba(255,255,255,.2) 0 70px, transparent 71px)';
const Loader = ({ text }) => (
  <Stack alignItems="center" spacing={2} sx={{ py: 8 }}><CircularProgress />{text && <Typography color="text.secondary">{text}</Typography>}</Stack>
);

export default function App() {
  const [user, setUser] = useState(undefined);
  const [role, setRole] = useState(null);
  const [snack, setSnack] = useState(null);
  const toast = (m, s = 'error') => setSnack({ m, s });
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!user) { setRole(null); return; }
    api('/me').then((m) => setRole(m.role)).catch((e) => toast(e.message));
  }, [user?.id]);

  let body;
  if (user === undefined || (user && !role)) body = <Loader text="Connecting… the first load can take up to a minute on the free tier." />;
  else if (!user) body = <Auth toast={toast} />;
  else if (role === 'teacher') body = <Teacher user={user} toast={toast} />;
  else if (role === 'student') body = <Student user={user} toast={toast} />;
  else body = <Typography sx={{ p: 4 }}>The admin screen is not built yet.</Typography>;
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {body}
      <Snackbar open={!!snack} autoHideDuration={5000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? <Alert severity={snack.s} variant="filled" onClose={() => setSnack(null)}>{snack.m}</Alert> : undefined}
      </Snackbar>
    </ThemeProvider>
  );
}

function Shell({ user, action, children }) {
  const [anchor, setAnchor] = useState(null);
  const name = user?.user_metadata?.full_name || user?.email || '';
  return (
    <>
      <AppBar position="sticky" color="inherit" elevation={0} sx={{ borderBottom: '1px solid #dadce0' }}>
        <Toolbar>
          <QrCode2Icon color="primary" sx={{ mr: 1 }} />
          <Typography variant="h6" sx={{ flex: 1, fontWeight: 500 }}>QR Attendance</Typography>
          {action}
          <IconButton onClick={(e) => setAnchor(e.currentTarget)} aria-label="Account">
            <Avatar sx={{ width: 32, height: 32, fontSize: 14, bgcolor: colorFor(user?.id) }}>{initials(name)}</Avatar>
          </IconButton>
          <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
            <MenuItem disabled>{user?.email}</MenuItem>
            <MenuItem onClick={() => sb.auth.signOut()}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: 3 }}>{children}</Container>
    </>
  );
}

function Auth({ toast }) {
  const [mode, setMode] = useState('in');
  const [f, setF] = useState({ role: 'student' });
  const [otp, setOtp] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = (fn) => async (e) => {
    e.preventDefault(); setBusy(true);
    try { await fn(); } catch (err) { toast(err.message); }
    setBusy(false);
  };
  const signIn = run(async () => {
    const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
    if (error) throw error;
  });
  const signUp = run(async () => {
    const { error } = await sb.auth.signUp({
      email: f.email, password: f.password,
      options: { data: { full_name: f.name, role: f.role, enrollment_no: f.enroll || '', phone: f.phone || '' } }
    });
    if (error) throw error;
    setOtp(true);
  });
  const verify = run(async () => {
    const { error } = await sb.auth.verifyOtp({ email: f.email, token: (f.code || '').trim(), type: 'signup' });
    if (error) throw error;
  });
  const student = f.role === 'student';
  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 420, borderRadius: 3 }}>
          <Stack alignItems="center" spacing={1} mb={2}>
            <QrCode2Icon color="primary" sx={{ fontSize: 44 }} />
            <Typography variant="h5">QR Attendance</Typography>
            <Typography color="text.secondary" variant="body2">Fast, live attendance with a QR code that changes every 30 seconds</Typography>
          </Stack>
          {otp ? (
            <Stack component="form" spacing={2} onSubmit={verify}>
              <Typography>We emailed a verification code to <b>{f.email}</b>.</Typography>
              <TextField label="Verification code" value={f.code || ''} onChange={set('code')} autoFocus required
                inputProps={{ inputMode: 'numeric', autoComplete: 'one-time-code', style: { letterSpacing: 6, fontSize: 22, textAlign: 'center' } }} />
              <Button type="submit" variant="contained" size="large" disabled={busy}>Verify</Button>
            </Stack>
          ) : (
            <>
              <Tabs value={mode} onChange={(_, v) => setMode(v)} variant="fullWidth" sx={{ mb: 2 }}>
                <Tab value="in" label="Sign in" /><Tab value="up" label="Create account" />
              </Tabs>
              <Stack component="form" spacing={2} onSubmit={mode === 'in' ? signIn : signUp}>
                {mode === 'up' && (
                  <>
                    <ToggleButtonGroup exclusive fullWidth color="primary" value={f.role} onChange={(_, v) => v && setF({ ...f, role: v })}>
                      <ToggleButton value="student">Student</ToggleButton><ToggleButton value="teacher">Teacher</ToggleButton>
                    </ToggleButtonGroup>
                    <TextField label="Full name" value={f.name || ''} onChange={set('name')} required />
                  </>
                )}
                <TextField label={mode === 'up' && student ? 'College email' : 'Email'} type="email" value={f.email || ''} onChange={set('email')} required autoComplete="username" />
                {mode === 'up' && student && (
                  <>
                    <TextField label="Enrollment no" value={f.enroll || ''} onChange={set('enroll')} required />
                    <TextField label="Phone no" type="tel" value={f.phone || ''} onChange={set('phone')} required />
                  </>
                )}
                <TextField label="Password" type="password" value={f.password || ''} onChange={set('password')} required
                  inputProps={{ minLength: 6 }} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
                <Button type="submit" variant="contained" size="large" disabled={busy}>
                  {mode === 'in' ? 'Sign in' : 'Send verification code'}
                </Button>
              </Stack>
            </>
          )}
        </Paper>
      </Box>
    </ThemeProvider>
  );
}

function ClassCard({ c, sub, onClick }) {
  return (
    <Card sx={{ '&:hover': { boxShadow: '0 1px 6px rgba(60,64,67,.3)' }, transition: 'box-shadow .2s' }}>
      <CardActionArea onClick={onClick}>
        <Box sx={{ bgcolor: colorFor(c.id), color: '#fff', p: 2, height: 96, backgroundImage: pattern }}>
          <Typography variant="h6" noWrap>{c.name}</Typography>
        </Box>
        <CardContent><Typography color="text.secondary" variant="body2">{sub}</Typography></CardContent>
      </CardActionArea>
    </Card>
  );
}

function Empty({ title, text }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 8, textAlign: 'center' }}>
      <QrCode2Icon sx={{ fontSize: 72, color: '#dadce0' }} />
      <Typography variant="h6">{title}</Typography>
      <Typography color="text.secondary">{text}</Typography>
    </Stack>
  );
}

function Teacher({ user, toast }) {
  const [view, setView] = useState({ name: 'home' });
  const [classes, setClasses] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await sb.from('classes').select('id,name,join_code,enrollments(count)').order('created_at', { ascending: false });
    if (error) toast(error.message); else setClasses(data);
  }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    try { await post('/classes', { name }); setDlg(false); setName(''); load(); } catch (e) { toast(e.message); }
  };
  const home = () => { setView({ name: 'home' }); load(); };
  const start = async (cls) => {
    try { const r = await post('/sessions', { class_id: cls.id }); setView({ name: 'live', cls, sid: r.session_id }); }
    catch (e) { toast(e.message); }
  };
  return (
    <Shell user={user} action={view.name === 'home' && (
      <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDlg(true)} sx={{ mr: 2 }}>Create class</Button>
    )}>
      {view.name === 'home' && (classes === null ? <Loader /> : classes.length === 0 ? (
        <Empty title="No classes yet" text="Create your first class, then share its join code with students." />
      ) : (
        <Grid container spacing={2}>
          {classes.map((c) => (
            <Grid item xs={12} sm={6} md={4} key={c.id}>
              <ClassCard c={c} sub={(c.enrollments[0]?.count ?? 0) + ' students · code ' + c.join_code} onClick={() => setView({ name: 'class', cls: c })} />
            </Grid>
          ))}
        </Grid>
      ))}
      {view.name === 'class' && <ClassPage cls={view.cls} back={home} start={() => start(view.cls)} toast={toast} />}
      {view.name === 'live' && <Live cls={view.cls} sid={view.sid} toast={toast} onEnd={() => setView({ name: 'summary', cls: view.cls, sid: view.sid })} />}
      {view.name === 'summary' && (
        <>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2}>
            <Typography variant="h5">{view.cls.name} · Session summary</Typography>
            <Button variant="contained" onClick={() => setView({ name: 'class', cls: view.cls })}>Back to class</Button>
          </Stack>
          <Roster cls={view.cls} sid={view.sid} live={false} toast={toast} />
        </>
      )}
      <Dialog open={dlg} onClose={() => setDlg(false)} fullWidth maxWidth="xs">
        <DialogTitle>Create class</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth margin="dense" label="Class name" value={name} onChange={(e) => setName(e.target.value)} /></DialogContent>
        <DialogActions><Button onClick={() => setDlg(false)}>Cancel</Button><Button variant="contained" disabled={!name.trim()} onClick={create}>Create</Button></DialogActions>
      </Dialog>
    </Shell>
  );
}

function ClassPage({ cls, back, start, toast }) {
  const [rep, setRep] = useState(null);
  useEffect(() => { api('/classes/' + cls.id + '/report').then(setRep).catch((e) => toast(e.message)); }, [cls.id]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(location.origin + '/app?join=' + cls.join_code); toast('Join link copied', 'success'); }
    catch { toast('Could not copy the link'); }
  };
  const rows = () => [
    ['Roll no', 'Student', ...rep.dates, 'Total classes', 'Present', 'Percentage'],
    ...rep.students.map((s) => [s.roll, s.name, ...rep.dates.map((d) => s.marks[d] || ''), s.total, s.present, s.percent ?? ''])
  ];
  const save = (blob, ext) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = cls.name.replace(/[^\w-]+/g, '_') + '_attendance.' + ext; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const csv = () => {
    const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    save(new Blob(['\ufeff' + rows().map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), 'csv');
  };
  const xlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows()), 'Attendance');
    XLSX.writeFile(wb, cls.name.replace(/[^\w-]+/g, '_') + '_attendance.xlsx');
  };
  const col = colorFor(cls.id);
  return (
    <>
      <Paper elevation={0} sx={{ p: 3, mb: 3, color: '#fff', bgcolor: col, backgroundImage: pattern, borderRadius: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-end' }} spacing={2}>
          <Box>
            <Typography variant="h4">{cls.name}</Typography>
            <Chip label={'Join code: ' + cls.join_code} onClick={copy} onDelete={copy} deleteIcon={<ContentCopyIcon />} sx={{ mt: 1, bgcolor: 'rgba(255,255,255,.92)' }} />
          </Box>
          <Stack direction="row" spacing={1}>
            <Button sx={{ color: '#fff' }} onClick={back}>All classes</Button>
            <Button variant="contained" color="inherit" sx={{ color: col, bgcolor: '#fff' }} startIcon={<QrCode2Icon />} onClick={start}>Start session</Button>
          </Stack>
        </Stack>
      </Paper>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2 }}>
          <Typography variant="h6">Attendance {rep ? '(' + rep.students.length + ' students)' : ''}</Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={!rep} onClick={csv}>Download CSV</Button>
            <Button size="small" variant="outlined" disabled={!rep} onClick={xlsx}>Download Excel</Button>
          </Stack>
        </Stack>
        {!rep ? <Loader /> : rep.students.length === 0 ? (
          <Empty title="No students yet" text="Share the join code or link with your students." />
        ) : (
          <TableContainer sx={{ maxHeight: 520 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ position: 'sticky', left: 0, zIndex: 3, minWidth: 110 }}>Roll no</TableCell>
                  <TableCell sx={{ position: 'sticky', left: 110, zIndex: 3, minWidth: 160 }}>Student</TableCell>
                  {rep.dates.map((d) => <TableCell key={d} align="center">{fmtDate(d)}</TableCell>)}
                  <TableCell align="center">Total classes</TableCell><TableCell align="center">Present</TableCell><TableCell align="center">%</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rep.students.map((s, i) => (
                  <TableRow key={i} hover>
                    <TableCell sx={{ position: 'sticky', left: 0, bgcolor: '#fff', zIndex: 1 }}>{s.roll}</TableCell>
                    <TableCell sx={{ position: 'sticky', left: 110, bgcolor: '#fff', zIndex: 1 }}>{s.name}</TableCell>
                    {rep.dates.map((d) => {
                      const m = s.marks[d];
                      return <TableCell key={d} align="center" sx={{ fontWeight: 700, color: m === 'P' ? '#188038' : m === 'A' ? '#d93025' : '#9aa0a6' }}>{m || '–'}</TableCell>;
                    })}
                    <TableCell align="center">{s.total}</TableCell><TableCell align="center">{s.present}</TableCell>
                    <TableCell align="center">
                      {s.percent === null ? '–' : <Chip size="small" label={s.percent + '%'} color={s.percent >= 75 ? 'success' : s.percent >= 50 ? 'warning' : 'error'} variant="outlined" />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </>
  );
}

function Live({ cls, sid, onEnd, toast }) {
  const [left, setLeft] = useState(30);
  const [src, setSrc] = useState('');
  const exp = useRef(0);
  const link = useRef('');
  const refresh = useCallback(async () => {
    try {
      const r = await api('/sessions/' + sid + '/token');
      exp.current = Date.now() + r.expires_in * 1000;
      link.current = location.origin + '/app?s=' + sid + '&t=' + r.token;
      const q = qrcode(0, 'M'); q.addData(link.current); q.make();
      setSrc(q.createDataURL(8, 2));
    } catch (e) { toast(e.message); exp.current = Date.now() + 3000; }
  }, [sid]);
  useEffect(() => {
    let busy = true;
    refresh().finally(() => { busy = false; });
    const t = setInterval(() => {
      const l = Math.max(0, (exp.current - Date.now()) / 1000);
      setLeft(l);
      if (l <= 0 && !busy) { busy = true; refresh().finally(() => { busy = false; }); }
    }, 250);
    return () => clearInterval(t);
  }, [refresh]);
  const end = async () => { try { await post('/sessions/' + sid + '/end'); onEnd(); } catch (e) { toast(e.message); } };
  const copy = async () => { try { await navigator.clipboard.writeText(link.current); toast('Scan link copied', 'success'); } catch { toast('Could not copy'); } };
  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={5}>
        <Card sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6">{cls.name}</Typography>
          <Typography color="text.secondary" variant="body2" mb={2}>Students: scan this code to mark attendance</Typography>
          <Box sx={{ position: 'relative', display: 'inline-block' }}>
            {src ? <Box component="img" src={src} alt="Attendance QR code" sx={{ width: '100%', maxWidth: 340, imageRendering: 'pixelated', border: '1px solid #dadce0', borderRadius: 2 }} /> : <Loader />}
          </Box>
          <Stack direction="row" justifyContent="center" alignItems="center" spacing={2} my={2}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress variant="determinate" value={(left / 30) * 100} size={52} />
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}><Typography variant="caption" fontWeight={700}>{Math.ceil(left)}s</Typography></Box>
            </Box>
            <Typography color="text.secondary" variant="body2">Code refreshes automatically</Typography>
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="center">
            <Button variant="outlined" onClick={copy}>Copy scan link</Button>
            <Button variant="contained" color="error" onClick={end}>End session</Button>
          </Stack>
        </Card>
      </Grid>
      <Grid item xs={12} md={7}><Roster cls={cls} sid={sid} live toast={toast} /></Grid>
    </Grid>
  );
}

function Roster({ cls, sid, live, toast }) {
  const [people, setPeople] = useState([]);
  const load = useCallback(async () => {
    const [enr, att] = await Promise.all([
      sb.from('enrollments').select('student_id, profiles(full_name, enrollment_no)').eq('class_id', cls.id),
      sb.from('attendance').select('student_id, marked_at, method').eq('session_id', sid)
    ]);
    const err = enr.error || att.error;
    if (err) return toast(err.message);
    const m = new Map(att.data.map((a) => [a.student_id, a]));
    setPeople(enr.data.map((r) => ({
      id: r.student_id, name: r.profiles?.full_name || 'Unnamed student', roll: r.profiles?.enrollment_no || '', rec: m.get(r.student_id)
    })).sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true })));
  }, [cls.id, sid]);
  useEffect(() => {
    load();
    if (!live) return undefined;
    const ch = sb.channel('att-' + sid)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance', filter: 'session_id=eq.' + sid }, load)
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [load, live]);
  const mark = async (id, present) => {
    try { await post('/sessions/' + sid + '/mark', { student_id: id, present }); load(); } catch (e) { toast(e.message); }
  };
  const here = people.filter((p) => p.rec), away = people.filter((p) => !p.rec);
  const panel = (title, arr, isP) => (
    <Grid item xs={12} md={live ? 12 : 6}>
      <Card>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 2, pb: 0 }}>
          <Typography variant="h6">{title}</Typography>
          <Chip size="small" color={isP ? 'success' : 'default'} label={isP ? here.length + ' of ' + people.length : away.length} />
        </Stack>
        <List dense>
          {arr.length === 0 && <ListItem><ListItemText secondary={isP ? 'Nobody yet.' : 'Everyone is present.'} /></ListItem>}
          {arr.map((p) => (
            <ListItem key={p.id} secondaryAction={
              <Button size="small" onClick={() => mark(p.id, !isP)}>{isP ? 'Mark absent' : 'Mark present'}</Button>
            }>
              <ListItemAvatar><Avatar sx={{ bgcolor: colorFor(p.id), width: 36, height: 36, fontSize: 14 }}>{initials(p.name)}</Avatar></ListItemAvatar>
              <ListItemText primary={p.name} secondary={[p.roll, isP && ((p.rec.method === 'manual' ? 'manual · ' : '') +
                new Date(p.rec.marked_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))].filter(Boolean).join(' · ')} />
            </ListItem>
          ))}
        </List>
      </Card>
    </Grid>
  );
  return (
    <Grid container spacing={2}>
      {panel('Present', here, true)}
      {panel(live ? 'Not yet present' : 'Absent', away, false)}
    </Grid>
  );
}

function Student({ user, toast }) {
  const q = useRef(new URLSearchParams(location.search)).current;
  const [classes, setClasses] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [code, setCode] = useState('');
  const [res, setRes] = useState(null);
  const [blocked, setBlocked] = useState('');
  const load = useCallback(async () => {
    const { data, error } = await sb.from('enrollments').select('classes(id,name)').order('joined_at');
    if (error) toast(error.message); else setClasses(data.map((r) => r.classes).filter(Boolean));
  }, []);
  const join = async (c) => {
    try { const r = await post('/classes/join', { code: c }); toast(r.message, 'success'); load(); } catch (e) { toast(e.message); }
  };
  useEffect(() => {
    (async () => {
      try { await post('/device', { device_id: deviceId() }); } catch (e) { setBlocked(e.message); return; }
      load();
      const s = q.get('s'), t = q.get('t'), j = q.get('join');
      if (j) join(j);
      else if (s && t) {
        try { const r = await post('/attend', { session_id: s, token: t, device_id: deviceId() }); setRes({ ok: true, msg: r.message }); }
        catch (e) { setRes({ ok: false, msg: e.message }); }
      }
      if (j || (s && t)) history.replaceState(null, '', location.pathname);
    })();
  }, []);
  if (res) {
    return (
      <ThemeProvider theme={theme}>
        <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: '100vh', p: 3, textAlign: 'center' }}>
          {res.ok ? <CheckCircleIcon sx={{ fontSize: 120, color: '#188038' }} /> : <ErrorIcon sx={{ fontSize: 120, color: '#d93025' }} />}
          <Typography variant="h4">{res.ok ? res.msg : 'Could not mark attendance'}</Typography>
          {!res.ok && <Typography color="text.secondary">{res.msg}</Typography>}
          <Button variant="contained" onClick={() => setRes(null)}>Done</Button>
        </Stack>
      </ThemeProvider>
    );
  }
  return (
    <Shell user={user} action={<Button startIcon={<AddIcon />} variant="contained" onClick={() => setDlg(true)} sx={{ mr: 2 }}>Join class</Button>}>
      {blocked && <Alert severity="error" sx={{ mb: 2 }}>{blocked}</Alert>}
      {classes === null ? (blocked ? null : <Loader />) : classes.length === 0 ? (
        <Empty title="You haven't joined any classes" text="Ask your teacher for a join code, then use “Join class”. To mark attendance, scan the teacher's QR code with your phone camera." />
      ) : (
        <>
          <Typography color="text.secondary" mb={2}>To mark attendance, scan the teacher's QR code with your phone camera.</Typography>
          <Grid container spacing={2}>
            {classes.map((c) => <Grid item xs={12} sm={6} md={4} key={c.id}><ClassCard c={c} sub="Enrolled" /></Grid>)}
          </Grid>
        </>
      )}
      <Dialog open={dlg} onClose={() => setDlg(false)} fullWidth maxWidth="xs">
        <DialogTitle>Join class</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth margin="dense" label="Class code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} inputProps={{ maxLength: 12 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDlg(false)}>Cancel</Button>
          <Button variant="contained" disabled={!code.trim()} onClick={() => { join(code); setDlg(false); setCode(''); }}>Join</Button>
        </DialogActions>
      </Dialog>
    </Shell>
  );
}
