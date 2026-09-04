/* =========================================================
   db.js — Supabase-backed data layer (cloud sync)

   Keeps the exact same DB.getAll/get/add/put/delete/clear
   function shapes as the old IndexedDB version, so app.js
   didn't need to change. Field names stay camelCase on the
   JS side; the DB columns are snake_case — this file is the
   only place that translates between the two.
   ========================================================= */

const SUPABASE_URL = 'https://topypilkdzgfuudmbhov.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvcHlwaWxrZHpnZnV1ZG1iaG92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNTk2MTYsImV4cCI6MjEwMjgzNTYxNn0.AQbTIj0dvF04Nd7JNxrizNrRS6oS1jGdMtpTj_ysrMw';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------- camelCase <-> snake_case ---------------- */
function toSnake(s){ return s.replace(/([A-Z])/g, '_$1').toLowerCase(); }
function toCamel(s){ return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase()); }
function rowToCamel(row){
  if(!row) return row;
  const out = {};
  for(const k in row) out[toCamel(k)] = row[k];
  return out;
}
function objToSnake(obj){
  const out = {};
  for(const k in obj) out[toSnake(k)] = obj[k];
  return out;
}

/* ---------------- auth ---------------- */
const Auth = {
  async getSession(){
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  async userId(){
    const s = await this.getSession();
    return s?.user?.id || null;
  },
  signUp(email, password){ return sb.auth.signUp({ email, password }); },
  signIn(email, password){ return sb.auth.signInWithPassword({ email, password }); },
  signOut(){ return sb.auth.signOut(); },
  onChange(cb){ sb.auth.onAuthStateChange((_event, session) => cb(session)); },
};

/* ---------------- generic CRUD (table name === store name) ---------------- */
const DB = {
  async getAll(store){
    if(store === 'settings'){
      const uid = await Auth.userId();
      const { data, error } = await sb.from('settings').select('*').eq('user_id', uid);
      if(error) throw error;
      return (data || []).map(rowToCamel);
    }
    const { data, error } = await sb.from(store).select('*');
    if(error) throw error;
    return (data || []).map(rowToCamel);
  },

  async get(store, id){
    if(store === 'settings'){
      const uid = await Auth.userId();
      const { data, error } = await sb.from('settings').select('*').eq('user_id', uid).maybeSingle();
      if(error) throw error;
      return rowToCamel(data);
    }
    const { data, error } = await sb.from(store).select('*').eq('id', id).maybeSingle();
    if(error) throw error;
    return rowToCamel(data);
  },

  async add(store, obj){
    const uid = await Auth.userId();
    const payload = objToSnake({ ...obj, userId: uid });
    delete payload.id; // let Postgres generate it
    const { data, error } = await sb.from(store).insert(payload).select().single();
    if(error) throw error;
    return data.id;
  },

  async put(store, obj){
    const uid = await Auth.userId();
    if(store === 'settings'){
      const payload = objToSnake({ ...obj, userId: uid });
      delete payload.id; // settings has no id column — user_id is the primary key
      const { error } = await sb.from('settings').upsert(payload, { onConflict: 'user_id' });
      if(error) throw error;
      return true;
    }
    const payload = objToSnake({ ...obj, userId: uid });
    const { id, ...rest } = payload;
    if(id){
      const { error } = await sb.from(store).update(rest).eq('id', id);
      if(error) throw error;
      return id;
    }
    const { data, error } = await sb.from(store).insert(rest).select().single();
    if(error) throw error;
    return data.id;
  },

  async delete(store, id){
    const { error } = await sb.from(store).delete().eq('id', id);
    if(error) throw error;
    return true;
  },

  async clear(store){
    const uid = await Auth.userId();
    const { error } = await sb.from(store).delete().eq('user_id', uid);
    if(error) throw error;
    return true;
  }
};

/* ---------------- first-run seed (per logged-in user) ---------------- */
const SEED_TECHNICIANS = [
  { name:'Adien Barton',        region:'east',     area:'',        techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Carlos Ortiz',        region:'west',     area:'',        techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Ella Harwood',        region:'floating', area:'Exterior technician — covers all London zones', techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Finlay Cooper',       region:'east',     area:'',        techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Helen Edwards',       region:'outside',  area:'Outside London', techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'James Moorhouse',     region:'west',     area:'',        techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Katherine Bass',      region:'east',     area:'',        techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Kathryn Calvert',     region:'outside',  area:'Outside London', techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Larisa Titu',         region:'east',     area:'',        techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Marie Goddard',       region:'outside',  area:'Outside London', techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
  { name:'Remi Weekes-Johns',   region:'east',     area:'Some sites outside London (mainly Essex)', techFrequencyDays:30, oneOnOneFrequencyDays:30, active:true },
];

const DEFAULT_SETTINGS = {
  techVisitsPerWeekMin: 3,
  qaVisitsPerWeekMin: 4,
  oneOnOnesPerWeekMax: 3,
  wfhWeekday: 3,
  emailStyle: 'formal',
  emailUrgency: 'not_urgent',
  emailUrgencyCustom: '',
  assistantDefaultInstruction: '',
  outlookIcsUrl: '',
  outlookLastSynced: null,
  emailAudience: 'middle_mgmt',
  emailAudienceCustom: '',
};

const SEED_ZONES = [
  { key:'east',     label:'East · North bank',  color:'#2C6E8C', soloRequired:false, sortOrder:1 },
  { key:'west',     label:'West · South bank',  color:'#8A5A2C', soloRequired:false, sortOrder:2 },
  { key:'outside',  label:'Outside London',     color:'#6B4A8C', soloRequired:true,  sortOrder:3 },
  { key:'floating', label:'Floating / exterior', color:'#2C8C6E', soloRequired:false, sortOrder:4 },
];

const SEED_EVENT_TYPES = [
  { key:'techVisit',   label:'Tech visit',          short:'Tech visit', color:'#2F6656', isSystem:true, sortOrder:1 },
  { key:'qaVisit',     label:'QA visit',             short:'QA visit',   color:'#B9861F', isSystem:true, sortOrder:2 },
  { key:'oneOnOne',    label:'1-1',                  short:'1-1',        color:'#6B4A8C', isSystem:true, sortOrder:3 },
  { key:'wfh',         label:'Working from home',    short:'WFH',        color:'#9A9689', isSystem:true, sortOrder:4 },
  { key:'leave',       label:'Annual leave',         short:'AL',         color:'#AD4A32', isSystem:true, sortOrder:5 },
  { key:'techAbsence', label:'Absence',              short:'Absence',    color:'#AD4A32', isSystem:true, sortOrder:6 },
  { key:'block',       label:'Recurring block',      short:'Block',      color:'#8A5A2C', isSystem:true, sortOrder:7 },
  { key:'other',       label:'Other / admin',        short:'Other',      color:'#2C6E8C', isSystem:true, sortOrder:8 },
];
const SEED_OUTLOOK_TYPE_RULES = [
  { pattern:'Tech Visit', eventType:'techVisit', sortOrder:1 },
  { pattern:'QA Visit',   eventType:'qaVisit',    sortOrder:2 },
  { pattern:'1-1',        eventType:'oneOnOne',   sortOrder:3 },
];

async function seedIfEmpty(){
  const existing = await DB.getAll('technicians');
  if(existing.length === 0){
    for(const t of SEED_TECHNICIANS){
      await DB.add('technicians', { ...t, createdAt: new Date().toISOString() });
    }
  }
  const existingSites = await DB.getAll('sites');
  if(existingSites.length === 0){
    await DB.add('sites', {
      name: 'General / TBC',
      region: 'floating',
      type: 'qa',
      address: '',
      technicianId: null,
      qaFrequencyDays: null,
      notes: 'Placeholder used by "Generate schedule" for QA visits before real client sites are set up. Reassign or delete once the real site list is in.',
      active: true,
      isGeneral: true,
      createdAt: new Date().toISOString(),
    });
  }
  const existingZones = await DB.getAll('zones');
  if(existingZones.length === 0){
    for(const z of SEED_ZONES){
      await DB.add('zones', { ...z, createdAt: new Date().toISOString() });
    }
  }
  const existingEventTypes = await DB.getAll('event_types');
  if(existingEventTypes.length === 0){
    for(const et of SEED_EVENT_TYPES){
      await DB.add('event_types', { ...et, createdAt: new Date().toISOString() });
    }
  }
  const existingOutlookRules = await DB.getAll('outlook_type_rules');
  if(existingOutlookRules.length === 0){
    for(const r of SEED_OUTLOOK_TYPE_RULES){
      await DB.add('outlook_type_rules', { ...r, createdAt: new Date().toISOString() });
    }
  }
  const settings = await DB.get('settings', 'settings');
  if(!settings){
    await DB.put('settings', { ...DEFAULT_SETTINGS });
  }
}

/* ---------- draft-email Edge Function ---------- */
async function draftEmail({ notes, style, urgency, urgencyCustom, audience, audienceCustom, examples }){
  const { data, error } = await sb.functions.invoke('draft-email', {
    body: { notes, style, urgency, urgencyCustom, audience, audienceCustom, examples },
  });
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data; // { subject, body }
}

async function analyseContent({ text, instruction, attachments }){
  const { data, error } = await sb.functions.invoke('analyse-content', {
    body: { text, instruction, attachments },
  });
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data; // { summary, actionPoints }
}

async function solveProblem(payload){
  const { data, error } = await sb.functions.invoke('solve-problem', { body: payload });
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data;
}

async function syncOutlookCalendar({ icsUrl }){
  const { data, error } = await sb.functions.invoke('sync-outlook-calendar', { body: { icsUrl } });
  if(error) throw error;
  if(data?.error) throw new Error(data.error);
  return data; // { events: [{uid, title, date, startTime, endTime, allDay}] }
}
