export default function SectionHeader({ eyebrow, title, description, aside }) {
  return (
    <div className="section-head" data-reveal>
      <div>
        {eyebrow ? <span className="section-eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
        {description ? <p className="section-description">{description}</p> : null}
      </div>
      {aside ? <div className="section-aside">{aside}</div> : null}
    </div>
  );
}
