"use client";
import { useState, useRef, useCallback } from "react";
import Image from "next/image";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { GripVertical } from "lucide-react";

type ImageItem = { id: string; url: string; caption: string | null; isPrimary: boolean; displayOrder: number };

export function VehiclePhotos({ vehicleId }: { vehicleId: string }) {
  const utils = trpc.useUtils();
  const { data: images } = trpc.fleet.listVehicleImages.useQuery({ vehicleId });
  const addImage = trpc.fleet.addVehicleImage.useMutation({
    onSuccess: () => utils.fleet.listVehicleImages.invalidate({ vehicleId }),
  });
  const deleteImage = trpc.fleet.deleteVehicleImage.useMutation({
    onSuccess: () => utils.fleet.listVehicleImages.invalidate({ vehicleId }),
  });
  const reorder = trpc.fleet.reorderVehicleImages.useMutation({
    onSuccess: () => utils.fleet.listVehicleImages.invalidate({ vehicleId }),
  });

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/vehicle-image", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "Upload failed");
      const { url, checksum } = (await res.json()) as { url: string; checksum?: string };
      await addImage.mutateAsync({ vehicleId, url, checksum });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !images) return;
      const oldIdx = images.findIndex((i) => i.id === active.id);
      const newIdx = images.findIndex((i) => i.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(images, oldIdx, newIdx);
      reorder.mutate({ vehicleId, imageIds: reordered.map((i) => i.id) });
    },
    [images, vehicleId, reorder],
  );

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-xl font-semibold">Photos</h2>
          <p className="text-xs text-muted-foreground">Drag to reorder. First photo is the primary image.</p>
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onPick}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "+ Add photo"}
          </Button>
        </div>
      </div>
      {err && <div className="text-sm text-destructive mb-2">{err}</div>}
      {images && images.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {images.map((img, idx) => (
                <SortableImage
                  key={img.id}
                  img={img}
                  isFirst={idx === 0}
                  onDelete={() => { if (confirm("Delete this photo?")) deleteImage.mutate({ id: img.id }); }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-muted-foreground text-sm">No photos yet. Add one so customers can see this scooter on the booking page.</p>
      )}
    </section>
  );
}

function SortableImage({
  img,
  isFirst,
  onDelete,
}: {
  img: ImageItem;
  isFirst: boolean;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group border rounded overflow-hidden">
      <div className="relative aspect-video bg-muted">
        <Image src={img.url} alt={img.caption ?? "Vehicle photo"} fill className="object-contain" sizes="(max-width: 768px) 50vw, 25vw" />
      </div>
      {isFirst && (
        <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">Primary</span>
      )}
      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          {...attributes}
          {...listeners}
          className="bg-background/80 backdrop-blur rounded p-1 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex gap-1 p-2 text-xs">
        <button
          className="underline text-destructive ml-auto"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
