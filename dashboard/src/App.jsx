import React, { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';
import { StatusBadge, timeAgo, humanBytes } from './components/ui.jsx';

export default function App() {
  const [route, setRoute] = useState(currentRoute());
  const [health, setHealth] = useState(null);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ error: true }));
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="triangle">▲</span> snow-deploy
        </a>
        <div className="spacer" />
        {health && !health.error && (
          <span className="badge-backend" title={health.backend?.target}>
            {health.backend?.kind}
          </span>
        )}
      </header>
      <main className="content">
        {route.name === 'project' ? (
          <ProjectDetail name={route.param} />
        ) : (
          <ProjectsGrid />
        )}
      </main>
    </div>
  );
}

function currentRoute() {
  const hash = window.location.hash.replace(/^#/, '');
  const m = hash.match(/^\/project\/(.+)$/);
  if (m) return { name: 'project', param: decodeURIComponent(m[1]) };
  return { name: 'projects' };
}

function ProjectsGrid() {
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.projects().then(setProjects).catch((e) => setError(e.message));
  }, []);

  if (error) return <Empty title="Couldn't load projects" detail={error} />;
  if (!projects) return <Loading />;
  if (projects.length === 0) {
    return (
      <Empty
        title="No projects yet"
        detail="Run `snowd deploy` inside a React app to create your first project."
      />
    );
  }

  return (
    <>
      <h1 className="page-title">Projects</h1>
      <div className="grid">
        {projects.map((p) => (
          <a key={p.id} className="card" href={`#/project/${encodeURIComponent(p.name)}`}>
            <div className="card-head">
              <span className="dot" />
              <span className="card-name">{p.name}</span>
            </div>
            <div className="card-meta">
              <span className="chip">{p.framework}</span>
              <span className="muted">created {timeAgo(p.createdAt)}</span>
            </div>
          </a>
        ))}
      </div>
    </>
  );
}

function ProjectDetail({ name }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.project(name).then(setData).catch((e) => setError(e.message));
  }, [name]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Empty title="Couldn't load project" detail={error} />;
  if (!data) return <Loading />;

  const { project, deployments, aliases } = data;
  const prodId = aliases.production?.deploymentId;

  return (
    <>
      <a className="back" href="#/">← Projects</a>
      <div className="detail-head">
        <h1 className="page-title">{project.name}</h1>
        <div className="detail-actions">
          {aliases.production && (
            <>
              <a className="btn" href={aliases.production.url} target="_blank" rel="noreferrer">
                Visit ↗
              </a>
              <button
                className="btn"
                disabled={busy || !aliases.production.previousDeploymentId}
                onClick={() => act(() => api.rollback(project.name))}
                title={
                  aliases.production.previousDeploymentId
                    ? 'Roll production back to the previous deployment'
                    : 'No previous deployment to roll back to'
                }
              >
                Rollback
              </button>
            </>
          )}
        </div>
      </div>

      <div className="alias-row">
        <AliasCard label="Production" alias={aliases.production} />
      </div>

      <h2 className="section">Deployments</h2>
      <div className="table">
        <div className="tr th">
          <span>Deployment</span>
          <span>Status</span>
          <span>Size</span>
          <span>Branch</span>
          <span>Age</span>
          <span />
        </div>
        {deployments.map((d) => (
          <div className="tr" key={d.id}>
            <span className="mono">
              {d.id}
              {d.id === prodId && <span className="prod-tag">prod</span>}
            </span>
            <span><StatusBadge status={d.status} /></span>
            <span className="muted">{humanBytes(d.sizeBytes)}</span>
            <span className="muted">{d.git?.branch || '–'}</span>
            <span className="muted">{timeAgo(d.createdAt)}</span>
            <span className="row-actions">
              <a className="link" href={d.url} target="_blank" rel="noreferrer">preview</a>
              {d.status === 'READY' && d.id !== prodId && (
                <button
                  className="link"
                  disabled={busy}
                  onClick={() => act(() => api.promote(d.id))}
                >
                  promote
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function AliasCard({ label, alias }) {
  return (
    <div className="alias-card">
      <div className="alias-label">{label}</div>
      {alias ? (
        <a className="alias-url" href={alias.url} target="_blank" rel="noreferrer">
          {alias.url}
        </a>
      ) : (
        <span className="muted">not deployed</span>
      )}
    </div>
  );
}

const Loading = () => <div className="state muted">Loading…</div>;
const Empty = ({ title, detail }) => (
  <div className="state">
    <div className="state-title">{title}</div>
    <div className="muted">{detail}</div>
  </div>
);
