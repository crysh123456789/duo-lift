"use client";

import { LoadBoard } from "@/components/load-board";
import { PageTitle } from "@/components/page-title";
import { RecordTabs } from "@/components/record-tabs";

export default function LoadsPage() {
  return (
    <div className="space-y-5" data-view="cargas">
      <PageTitle title="Cargas" />
      <div>
        <p className="font-mono text-xs tracking-[0.25em] text-accent uppercase">Historial</p>
        <h1 className="text-3xl font-medium tracking-tight">Cargas</h1>
        <p className="mt-1 text-sm text-muted">El peso de trabajo de cada ejercicio.</p>
      </div>
      <RecordTabs current="cargas" />
      <LoadBoard />
    </div>
  );
}
