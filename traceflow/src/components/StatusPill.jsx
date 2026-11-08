const TONES = {
  critical: 'bg-[#FBE5EC] text-[#A51640] border-[#EDB9C9]',
  new: 'bg-[#E6EFF9] text-[#1F4E75] border-[#CBDDEE]',
  needs_review: 'bg-[#F8EEDF] text-[#8A5A1E] border-[#EDDCC0]',
  approved: 'bg-[#E7F1FA] text-[#1E5578] border-[#C9DEEE]',
  rejected: 'bg-[#F5E4E1] text-[#8C3B2E] border-[#EBD0CB]',
  resolved: 'bg-[#EDEAE2] text-[#4E5548] border-[#E0DCD0]',
  high: 'bg-[#F5E4E1] text-[#8C3B2E] border-[#EBD0CB]',
  medium: 'bg-[#F8EEDF] text-[#8A5A1E] border-[#EDDCC0]',
  low: 'bg-[#EDEAE2] text-[#4E5548] border-[#E0DCD0]',
  draft: 'bg-[#EDEAE2] text-[#4E5548] border-[#E0DCD0]',
  review: 'bg-[#F8EEDF] text-[#8A5A1E] border-[#EDDCC0]',
  ok: 'bg-[#E7F1FA] text-[#1E5578] border-[#C9DEEE]',
  error: 'bg-[#F5E4E1] text-[#8C3B2E] border-[#EBD0CB]',
  running: 'bg-[#E6EFF9] text-[#1F4E75] border-[#CBDDEE]',
};

export default function StatusPill({ tone = 'new', children, dot = true }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-[3px] text-[10.5px] font-medium leading-none ${
        TONES[tone] || TONES.new
      }`}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}
