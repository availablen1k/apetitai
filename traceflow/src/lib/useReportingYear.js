import { useSearchParams } from 'react-router-dom';

export default function useReportingYear(overview) {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get('year'));
  const explicit = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : null;
  const year = explicit ?? overview?.year ?? new Date().getFullYear();
  const years = [...new Set([new Date().getFullYear(), year, ...(overview?.years || [])])].sort((a, b) => b - a);
  const setYear = (value) => setParams((previous) => { previous.set('year', String(value)); return previous; });
  return { year, years, setYear };
}
