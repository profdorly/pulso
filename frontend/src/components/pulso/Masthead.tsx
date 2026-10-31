import { NavLink } from "react-router-dom";
import {
  BRAND_LOGO_DARK_PATH,
  BRAND_LOGO_LIGHT_PATH,
  PUBLISHER_NAME,
  PUBLISHER_URL,
  SITE_TAGLINE,
} from "../../lib/siteBase.js";
import { publicAssetUrl } from "../../lib/paths.js";

const links = [
  { to: "/", label: "Capa", end: true },
  { to: "/arquivo/", label: "Arquivo", end: false },
  { to: "/semana/", label: "Semana", end: false },
  { to: "/modelos/", label: "Modelos", end: false },
  { to: "/metodologia/", label: "Metodologia", end: false },
];

export function Masthead() {
  return (
    <header className="pulso-masthead">
      <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <NavLink to="/" className="pulso-wordmark">
            Pulso
          </NavLink>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-muted md:text-lg">{SITE_TAGLINE}</p>
        </div>
        <div className="flex flex-col items-start gap-6 lg:items-end">
          <a href={PUBLISHER_URL} aria-label={PUBLISHER_NAME} className="inline-block">
            {/* Lazy on purpose: the CSS hides one of the two per color scheme, and a hidden lazy
                image is never fetched, so each reader downloads one logo instead of both. */}
            <img
              src={publicAssetUrl(BRAND_LOGO_LIGHT_PATH)}
              alt={PUBLISHER_NAME}
              width={800}
              height={123}
              loading="lazy"
              className="brand-logo--light h-8 w-auto md:h-9"
            />
            <img
              src={publicAssetUrl(BRAND_LOGO_DARK_PATH)}
              alt=""
              width={800}
              height={123}
              loading="lazy"
              className="brand-logo--dark h-8 w-auto md:h-9"
            />
          </a>
          <nav className="flex w-full flex-wrap gap-x-3 gap-y-1 sm:gap-x-6 lg:justify-end" aria-label="Seções">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) => (isActive ? "pulso-nav-link font-semibold" : "pulso-nav-link")}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </header>
  );
}
