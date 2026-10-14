import { useEffect, useState } from "react";
import { rmq, type Page, type Resource } from "./api";
import { usePoll, useRabbit } from "./context";
import type { SortState } from "./parts";

const PAGE_SIZE = 200;

/**
 * Server-side (or backend-side) paged, filtered and sorted listing of a resource,
 * scoped to the tab's vhost and search box. Re-polls on every refresh tick.
 */
export function usePaged<T>(resource: Resource, defaultSort: SortState | null, opts: { enabled?: boolean; vhostScoped?: boolean } = {}) {
  const { connId, vhost, search, useRegex } = useRabbit();
  const scopedVhost = opts.vhostScoped === false ? null : vhost;
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(defaultSort);

  useEffect(() => setPage(1), [connId, scopedVhost, search, useRegex, sort?.key, sort?.desc]);

  const q = usePoll<Page<T>>(
    () => rmq.listPage<T>(connId, {
      resource, vhost: scopedVhost, page, pageSize: PAGE_SIZE,
      nameFilter: search.trim() || null, useRegex, sort: sort?.key, sortReverse: sort?.desc,
    }),
    [connId, resource, scopedVhost, page, search, useRegex, sort?.key, sort?.desc],
    { enabled: opts.enabled },
  );

  return {
    ...q,
    rows: q.data?.items ?? [],
    page: q.data?.page ?? page,
    setPage,
    sort,
    setSort,
  };
}
