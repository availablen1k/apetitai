// A small nature-model folder for API tests: the real schema, query SQL and catalogue from
// nature_model/, a handful of rows, one build-time saved run with lineage, and stub Python tools
// that stand in for the slow builders (they print what the real tools print).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MODEL = path.resolve('nature_model/model/nature');
const QUERIES = ['01_contract_area', '03_ecological_context', '04_monitoring_change'];

const STUBS: Record<string, string> = {
  'build_nature_model.py': `import json,os,sys\nprint(json.dumps({"stub":"build","argv":sys.argv[1:],"gemini_key_visible":"GEMINI_API_KEY" in os.environ}))\n`,
  'check_environment.py': `import json\nprint(json.dumps({"ready":True,"failures":[]}))\n`,
  'create_snapshot.py': `print("backups/stub-snapshot/nature.sqlite")\n`,
  'query_nature_model.py': `import sys\nprint("result_key")\nprint("Saved query run: 04_monitoring_change:stub123",file=sys.stderr)\n`,
  'build_nutrient_inputs.py': `import json,sqlite3,sys,time,pathlib
args=sys.argv[1:]
year=int(args[args.index('--year')+1])
if year==1999:
    print('build_nutrient_inputs.py: error: Year has no fields',file=sys.stderr); sys.exit(2)
if year==2001:
    time.sleep(30)
out=pathlib.Path(__file__).resolve().parents[1]/'analysis/nature/input_runs'/f'{year}-stub000000001'
out.mkdir(parents=True,exist_ok=False)
db=sqlite3.connect(out/'inputs.sqlite')
db.executescript("CREATE TABLE input_run(run_id TEXT, created_at_utc TEXT, year INTEGER); CREATE TABLE input_value(input_name TEXT, variant TEXT, value_kind TEXT);")
db.execute("INSERT INTO input_run VALUES('nutrient-inputs:stub','2026-01-01',?)",(year,))
db.execute("INSERT INTO input_value VALUES('p_kg_ha','reported_only','observed')")
db.commit(); db.close()
(out/'validation.json').write_text(json.dumps({"year":year,"scientific_status":"provisional"}))
print(json.dumps({"output":str(out),"year":year}))
`,
};

export function makeNatureModel(opts: { withDatabase?: boolean } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traceflow-nature-'));
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'analysis/nature'), { recursive: true });
  for (const [name, body] of Object.entries(STUBS)) fs.writeFileSync(path.join(dir, 'tools', name), body);
  const dbPath = path.join(dir, 'analysis/nature/nature.sqlite');
  if (opts.withDatabase !== false) buildFixtureDatabase(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function buildFixtureDatabase(file: string) {
  const db = new DatabaseSync(file);
  for (const f of ['schema.sql', 'extensions.sql', 'decision_context.sql']) db.exec(fs.readFileSync(path.join(MODEL, f), 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  const run = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).run(...p);
  run("INSERT INTO build_run VALUES ('nature-decision-context-v4', '2026-11-07T00:00:00+00:00', '{}', '{\"stage\":\"decisions\"}')");
  run("INSERT INTO catchment VALUES ('CA01','FI_SW','river','moderate',0.3,120,900,1.2,1), ('CA02','FI_SW','lake','good',0.2,80,400,1.6,0)");
  run("INSERT INTO catchment_monitoring VALUES ('CA01',2019,5369,109522,'measured'), ('CA01',2025,5128,117975,'measured')");
  run("INSERT INTO catchment_geometry VALUES ('CA01','urn:ogc:def:crs:OGC:1.3:CRS84','{\"type\":\"Polygon\",\"coordinates\":[[[22,61],[22.4,61],[22.4,60.8],[22,60.8],[22,61]]]}')");
  run("INSERT INTO farm (farm_id, country, region, segment, contract_crops) VALUES ('F0001','FI','FI_SW','veg','pea')");
  run("INSERT INTO parcel VALUES ('F0001-P01','F0001','CA01',61,22.1,4.5,'clay',30,2,150,'subsurface',12,1)");
  run("INSERT INTO parcel_geometry VALUES ('F0001-P01','urn:ogc:def:crs:OGC:1.3:CRS84','{\"type\":\"Polygon\",\"coordinates\":[[[22.1,60.9],[22.11,60.9],[22.11,60.89],[22.1,60.89],[22.1,60.9]]]}')");
  run("INSERT INTO transformation VALUES ('copy_typed','Same-name CSV fields; no corrections.')");
  run("INSERT INTO source_file VALUES ('src1','06_nature/monitored_catchment_loads.csv','abc123',100,'csv')");
  const catalog = JSON.parse(fs.readFileSync(path.join(MODEL, 'queries/catalog.json'), 'utf8')) as { id: string; lineage: string; description: string; grain: string; parameters: object }[];
  for (const q of catalog.filter((x) => QUERIES.includes(x.id))) {
    run('INSERT INTO query_definition VALUES (?,?,?,?,?,?)', q.id, q.description, q.grain, JSON.stringify(q.parameters), fs.readFileSync(path.join(MODEL, 'queries', `${q.id}.sql`), 'utf8'), fs.readFileSync(path.join(MODEL, 'queries', q.lineage), 'utf8'));
  }
  // Build-time default run of 04 with one traced result: result -> monitoring row -> source row.
  run("INSERT INTO query_run VALUES ('04_monitoring_change:default','04_monitoring_change','2026-11-07T00:00:00+00:00','{}','sql','x','lineage','y','desc')");
  const resultId = `query_result:${JSON.stringify(['04_monitoring_change:default', 'CA01'])}`;
  const monitoringId = `catchment_monitoring:${JSON.stringify(['CA01', 2025])}`;
  run('INSERT INTO entity_record VALUES (?,?,?)', resultId, 'query_result', JSON.stringify(['04_monitoring_change:default', 'CA01']));
  run('INSERT INTO entity_record VALUES (?,?,?)', monitoringId, 'catchment_monitoring', JSON.stringify(['CA01', 2025]));
  run("INSERT INTO query_result VALUES (?, '04_monitoring_change:default', 'CA01', '{\"result_key\":\"CA01\"}')", resultId);
  run("INSERT INTO record_dependency VALUES (?, ?, 'row-level input')", resultId, monitoringId);
  run("INSERT INTO source_record VALUES ('rec1','src1','csv_line:2','{}')");
  run("INSERT INTO record_source VALUES (?, 'rec1', 'copy_typed')", monitoringId);
  db.close();
}
