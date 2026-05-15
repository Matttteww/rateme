import React from "react";

/** Hero-шапка раздела с орбами и анимацией всплывания (как у Биты / Оупены). */
export function SectionHero({ eyebrow, title, sub, tone = "orange" }) {
  return (
    <header className={`sectionHero sectionHero--${tone}`}>
      <span className="sectionHero__orb sectionHero__orb--a" aria-hidden />
      <span className="sectionHero__orb sectionHero__orb--b" aria-hidden />
      <div className="sectionHero__inner">
        {eyebrow && <span className="sectionHero__eyebrow">{eyebrow}</span>}
        <h2 className="sectionHero__title">{title}</h2>
        {sub && <p className="sectionHero__sub">{sub}</p>}
      </div>
    </header>
  );
}
