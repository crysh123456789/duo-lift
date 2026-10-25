import { notFound } from "next/navigation";
import { SeriesMock } from "./series-mock";

/** Local mock for the series editor. Production never renders it. */
export default function DevSeriesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SeriesMock />;
}
