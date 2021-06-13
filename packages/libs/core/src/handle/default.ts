import { renderErrorPage } from "./error";
import { setCustomHeaders } from "./headers";
import { redirect } from "./redirect";
import { toRequest } from "./request";
import { routeDefault } from "../route";
import { addDefaultLocaleToPath } from "../route/locale";
import { Handler } from "./types";
import {
  Event,
  ExternalRoute,
  PageManifest,
  PrerenderManifest,
  PublicFileRoute,
  RedirectRoute,
  RenderRoute,
  RoutesManifest,
  StaticRoute,
  UnauthorizedRoute
} from "../types";
import { unauthorized } from "./unauthorized";

export const renderRoute = async (
  event: Event,
  route: RenderRoute,
  manifest: PageManifest,
  routesManifest: RoutesManifest,
  getPage: (page: string) => any
): Promise<void | StaticRoute> => {
  const { req, res } = event;
  setCustomHeaders(event, routesManifest);

  // For SSR rewrites to work the page needs to be passed a localized url
  if (req.url && routesManifest.i18n) {
    req.url = addDefaultLocaleToPath(req.url, routesManifest);
  }

  // Sets error page status code so _error renders the right page
  if (route.statusCode) {
    res.statusCode = route.statusCode;
  }

  const page = getPage(route.page);
  try {
    if (route.isData) {
      const { renderOpts } = await page.renderReqToHTML(
        req,
        res,
        "passthrough"
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(renderOpts.pageData));
    } else {
      await Promise.race([page.render(req, res), event.responsePromise]);
    }
  } catch (error) {
    return renderErrorPage(
      error,
      event,
      route,
      manifest,
      routesManifest,
      getPage
    );
  }
};

/*
 * Handles page and data routes.
 *
 * Returns one of: ExternalRoute, PublicFileRoute, StaticRoute
 * for handling in the caller.
 *
 * If return is void, the response has already been generated in
 * event.res/event.responsePromise which the caller should wait on.
 */
export const handleDefault = async (
  event: Event,
  manifest: PageManifest,
  prerenderManifest: PrerenderManifest,
  routesManifest: RoutesManifest,
  handler: Handler
): Promise<ExternalRoute | PublicFileRoute | StaticRoute | void> => {
  const request = toRequest(event);
  const route = await routeDefault(
    request,
    manifest,
    prerenderManifest,
    routesManifest
  );
  if (route.querystring) {
    event.req.url = `${event.req.url}${request.querystring ? "&" : "?"}${
      route.querystring
    }`;
  }
  if (route.isRedirect) {
    return redirect(event, route as RedirectRoute);
  }
  if (route.isRender) {
    return renderRoute(
      event,
      route as RenderRoute,
      manifest,
      routesManifest,
      handler.getPage
    );
  }
  if (route.isUnauthorized) {
    return unauthorized(event, route as UnauthorizedRoute);
  }

  if (route.isStatic) {
    const staticRoute = route as StaticRoute;
    if (staticRoute.fallback !== undefined || staticRoute.revalidate) {
      if (await handler.getFile(event, staticRoute)) {
        return;
      }
      // TODO: handle fallback here?
    }
  }

  // Let typescript check this is correct type to be returned
  return route;
};
