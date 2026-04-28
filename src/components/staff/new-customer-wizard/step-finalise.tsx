"use client";

import * as React from "react";
import {
  useFieldArray,
  useFormContext,
  useWatch,
  type Control,
} from "react-hook-form";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid } from "@/components/forms/form-grid";
import { IdDropZone } from "./id-drop-zone";
import { CustomerPhotoCapture } from "./customer-photo-capture";
import { OTHER_DOC_TYPES, type WizardFormValues } from "./wizard-types";

export function StepFinalise() {
  const form = useFormContext<WizardFormValues>();
  const customerPhotoUrl = useWatch({ control: form.control, name: "customerPhotoUrl" });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer photo</CardTitle>
          <p className="text-caption text-muted-foreground">
            A clear head-and-shoulders photo. Used throughout the app so staff can
            quickly recognise returning customers.
          </p>
        </CardHeader>
        <CardContent>
          <CustomerPhotoCapture
            value={customerPhotoUrl ?? ""}
            onChange={(url) =>
              form.setValue("customerPhotoUrl", url, { shouldDirty: true })
            }
          />
        </CardContent>
      </Card>

      <EmergencyContactCard control={form.control} />
      <OtherDocumentsCard control={form.control} />
      <StaffNoteCard control={form.control} />
    </div>
  );
}

function EmergencyContactCard({ control }: { control: Control<WizardFormValues> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Emergency contact</CardTitle>
      </CardHeader>
      <CardContent>
        <FormGrid cols={2}>
          <FormField
            control={control}
            name="emergencyContactName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="emergencyContactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input type="tel" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name="emergencyContactRelationship"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Relationship</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. spouse, parent, friend" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </FormGrid>
      </CardContent>
    </Card>
  );
}

function OtherDocumentsCard({ control }: { control: Control<WizardFormValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "documents" });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Additional files</CardTitle>
        <p className="text-caption text-muted-foreground">
          Visa, international driving permit, proof of address, or anything else
          relevant. Drop files into the zone — each row becomes a document on the
          customer&apos;s file.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {fields.length === 0 && (
          <p className="text-sm text-muted-foreground">No additional files attached.</p>
        )}
        {fields.map((f, i) => (
          <div
            key={f.id}
            className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]"
          >
            <FormField
              control={control}
              name={`documents.${i}.type` as const}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {OTHER_DOC_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`documents.${i}.label` as const}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Label (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Electricity bill Mar 2026" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex items-end justify-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(i)}
                aria-label="Remove document"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="md:col-span-2">
              <FormField
                control={control}
                name={`documents.${i}.fileUrl` as const}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>File</FormLabel>
                    <IdDropZone
                      label=""
                      value={field.value || ""}
                      onChange={field.onChange}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={control}
              name={`documents.${i}.expiryDate` as const}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expiry (optional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            append({ type: "OTHER", fileUrl: "", label: "", expiryDate: "" })
          }
        >
          <Plus className="h-4 w-4" />
          Add file
        </Button>
      </CardContent>
    </Card>
  );
}

function StaffNoteCard({ control }: { control: Control<WizardFormValues> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Internal staff note</CardTitle>
      </CardHeader>
      <CardContent>
        <FormField
          control={control}
          name="staffNote"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="sr-only">Staff note</FormLabel>
              <FormControl>
                <textarea
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="e.g. Walk-in at Byron, referred by Gold Coast depot. Needs helmet sized L."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
}
