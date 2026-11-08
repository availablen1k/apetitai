export default function DecisionBlock({title,children}) {
  return <section className="space-y-2 border-t border-border pt-4"><h3 className="text-[14px] font-semibold text-[#23465B]">{title}</h3><div className="text-[12.5px] leading-relaxed">{children}</div></section>;
}
