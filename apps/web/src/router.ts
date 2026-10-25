import { useEffect, useState } from "react";

/** `/app/:space/:path…` → `{ space, path }`. The app has one screen, so this is all the routing it needs. */
export interface Route {
  space: string | undefined;
  path: string | undefined;
}

export function parseRoute(pathname: string): Route {
  const rest = pathname.replace(/^\/app\/?/, "").replace(/\/$/, "");
  const [space, ...parts] = rest ? rest.split("/") : [];
  return { space: space || undefined, path: parts.length ? parts.join("/") : undefined };
}

export function navigate(space: string, path?: string) {
  history.pushState(null, "", `/app/${space}${path ? `/${path}` : ""}`);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname));
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return route;
}
