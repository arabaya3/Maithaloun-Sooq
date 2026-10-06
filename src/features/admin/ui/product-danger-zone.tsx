"use client";

import { Archive, Trash2 } from "lucide-react";
import { useActionState, useId, useState } from "react";

import {
  archiveProductAction,
  deleteProductAction,
  type CatalogActionResult,
} from "@/features/admin/application/catalog-management-actions";

export interface ProductReferenceCounts {
  orders: number;
  purchases: number;
  sales: number;
  stockMovements: number;
}

const referenceLabels: Record<keyof ProductReferenceCounts, string> = {
  orders: "طلبات",
  purchases: "فواتير شراء",
  sales: "فواتير بيع",
  stockMovements: "حركات مخزون",
};

/** Archive is the normal way out; permanent delete is only for a product nothing points to. */
export function ProductDangerZone({
  domainId,
  name,
  references,
  archived,
}: {
  domainId: string;
  name: string;
  references: ProductReferenceCounts;
  archived: boolean;
}) {
  const id = useId();
  const [archiveState, archiveAction, archiving] = useActionState<
    CatalogActionResult,
    FormData
  >(archiveProductAction, null);
  const [deleteState, deleteAction, deleting] = useActionState<
    CatalogActionResult,
    FormData
  >(deleteProductAction, null);
  const [typed, setTyped] = useState("");
  const used = (Object.keys(references) as Array<keyof ProductReferenceCounts>)
    .filter((key) => references[key] > 0)
    .map((key) => `${referenceLabels[key]}: ${references[key]}`);

  return (
    <section className="admin-danger-zone" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>منطقة الخطر</h2>

      {archived ? (
        <p className="admin-muted">
          المنتج مؤرشف. استعيديه من تبويب «مؤرشف» في قائمة المنتجات.
        </p>
      ) : (
        <form action={archiveAction} className="admin-danger-block">
          <input type="hidden" name="domainId" value={domainId} />
          <div>
            <h3>أرشفة المنتج</h3>
            <p className="admin-muted">
              يختفي من المتجر ومن القوائم، وتبقى طلباته وفواتيره كما هي. يمكن
              استعادته في أي وقت.
            </p>
          </div>
          <label htmlFor={`${id}-reason`}>
            سبب الأرشفة
            <input
              id={`${id}-reason`}
              name="reason"
              required
              minLength={2}
              maxLength={200}
              placeholder="مثلاً: توقف المورد عن توريده"
            />
          </label>
          {archiveState && !archiveState.ok ? (
            <p className="admin-form-error" role="alert">
              {archiveState.message}
            </p>
          ) : null}
          <button
            type="submit"
            className="admin-btn admin-btn-secondary"
            disabled={archiving}
          >
            <Archive size={18} aria-hidden="true" />
            {archiving ? "جارٍ الأرشفة…" : "أرشفة المنتج"}
          </button>
        </form>
      )}

      <div className="admin-danger-block" data-tone="danger">
        <div>
          <h3>حذف نهائي</h3>
          {used.length ? (
            <>
              <p>
                لا يمكن حذف هذا المنتج نهائياً لأنه مرتبط بسجلات يجب أن تبقى
                صحيحة:
              </p>
              <ul>
                {used.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="admin-muted">أرشفيه بدلاً من ذلك.</p>
            </>
          ) : (
            <p className="admin-muted">
              لا توجد طلبات أو فواتير أو حركات مخزون لهذا المنتج. الحذف يزيله مع
              أصنافه ومواصفاته ولا يمكن التراجع عنه.
            </p>
          )}
        </div>
        {used.length ? null : (
          <form action={deleteAction} className="admin-danger-confirm">
            <input type="hidden" name="domainId" value={domainId} />
            <label htmlFor={`${id}-confirm`}>
              للتأكيد اكتبي اسم المنتج: <bdi>«{name}»</bdi>
              <input
                id={`${id}-confirm`}
                name="confirmName"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
            {deleteState && !deleteState.ok ? (
              <p className="admin-form-error" role="alert">
                {deleteState.message}
              </p>
            ) : null}
            <button
              type="submit"
              className="admin-btn admin-btn-danger"
              disabled={deleting || typed.trim() !== name.trim()}
            >
              <Trash2 size={18} aria-hidden="true" />
              {deleting ? "جارٍ الحذف…" : "حذف نهائي"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
