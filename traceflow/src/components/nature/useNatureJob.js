import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

// Submits one Python job and polls it until it finishes. A retried click reuses the same
// request id, so the server returns the original job instead of starting a second one.
export function useNatureJob(onDone) {
  const qc = useQueryClient();
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const pending = useRef(null);
  const timer = useRef(null);
  const busy = job && ['queued', 'running'].includes(job.status);

  useEffect(() => () => clearTimeout(timer.current), []);

  const poll = (id) => {
    timer.current = setTimeout(async () => {
      try {
        const next = await api.natureJob(id);
        setJob(next);
        if (['queued', 'running'].includes(next.status)) poll(id);
        else {
          pending.current = null;
          qc.invalidateQueries({ queryKey: ['nature'] });
          onDone?.(next);
        }
      } catch (e) {
        setError(e.message);
      }
    }, 1500);
  };

  const submit = async (body) => {
    setError(null);
    const key = JSON.stringify(body);
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: `ui-${crypto.randomUUID()}` };
    try {
      const created = await api.natureSubmitJob({ ...body, request_id: pending.current.id });
      setJob(created);
      qc.invalidateQueries({ queryKey: ['nature', 'jobs'] });
      if (['queued', 'running'].includes(created.status)) poll(created.id);
      else pending.current = null;
      return created;
    } catch (e) {
      pending.current = null;
      setError(e.message);
      return null;
    }
  };

  return { job, error, busy, submit, reset: () => { setJob(null); setError(null); } };
}
