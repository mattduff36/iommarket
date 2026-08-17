"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeMakeLookupKey } from "@/lib/vehicle-catalogue/make-canonicalization";
import {
  cleanCatalogueName,
  normalizeCatalogueName,
} from "@/lib/vehicle-catalogue/normalize";
import type {
  VehicleMakeOption,
  VehicleModelOption,
} from "@/lib/vehicle-catalogue/queries";

interface AttributeDef {
  id: string;
  name: string;
  required: boolean;
}

export interface VehicleCatalogueSelection {
  makeMode: "catalogue" | "manual";
  modelMode: "catalogue" | "manual";
  canonicalMake?: string;
  canonicalModel?: string;
  variant?: string;
}

interface Props {
  makeAttribute: AttributeDef;
  modelAttribute: AttributeDef;
  makes: VehicleMakeOption[];
  makeValue: string;
  modelValue: string;
  makeError?: string;
  modelError?: string;
  required: boolean;
  onChange: (attributeId: string, value: string) => void;
  onSelectionChange: (selection: VehicleCatalogueSelection) => void;
}

interface ParsedModelValue {
  model: VehicleModelOption;
  variant: string;
}

function matchMake(makes: VehicleMakeOption[], value: string) {
  const key = normalizeMakeLookupKey(value);
  return makes.find((make) => make.normalizedName === key) ?? null;
}

function parseModelValue(
  models: VehicleModelOption[],
  value: string,
): ParsedModelValue | null {
  const cleaned = cleanCatalogueName(value);
  if (!cleaned) return null;
  const tokens = cleaned.split(" ");
  let best:
    | (ParsedModelValue & { consumedTokens: number; matchedLength: number })
    | null = null;

  for (const model of models) {
    const names = [model.name, ...model.aliases];
    const keys = new Set(names.map(normalizeCatalogueName));
    for (let tokenCount = 1; tokenCount <= tokens.length; tokenCount += 1) {
      const candidate = tokens.slice(0, tokenCount).join(" ");
      const candidateKey = normalizeCatalogueName(candidate);
      if (!keys.has(candidateKey)) continue;
      const next = {
        model,
        variant: cleanCatalogueName(tokens.slice(tokenCount).join(" ")),
        consumedTokens: tokenCount,
        matchedLength: candidateKey.length,
      };
      if (
        !best ||
        next.consumedTokens > best.consumedTokens ||
        (next.consumedTokens === best.consumedTokens &&
          next.matchedLength > best.matchedLength)
      ) {
        best = next;
      }
    }
  }

  return best ? { model: best.model, variant: best.variant } : null;
}

function joinModelValue(model: string, variant: string) {
  return cleanCatalogueName([model, variant].filter(Boolean).join(" "));
}

function getVariantMaxLength(model: string) {
  return Math.min(
    60,
    Math.max(0, 80 - cleanCatalogueName(model).length - 1),
  );
}

export function VehicleCatalogueFields({
  makeAttribute,
  modelAttribute,
  makes,
  makeValue,
  modelValue,
  makeError,
  modelError,
  required,
  onChange,
  onSelectionChange,
}: Props) {
  const initialMake = matchMake(makes, makeValue);
  const [makeMode, setMakeMode] = useState<"catalogue" | "manual">(
    makes.length === 0 || (makeValue && !initialMake) ? "manual" : "catalogue",
  );
  const [modelMode, setModelMode] = useState<"catalogue" | "manual">(
    makes.length === 0 || (makeValue && !initialMake) ? "manual" : "catalogue",
  );
  const [models, setModels] = useState<VehicleModelOption[]>([]);
  const [modelsPending, setModelsPending] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelText, setModelText] = useState(modelValue);
  const [variant, setVariant] = useState("");
  const [variantVisible, setVariantVisible] = useState(false);
  const cacheRef = useRef(new Map<string, VehicleModelOption[]>());
  const requestTokenRef = useRef(0);
  const lastEmittedMakeRef = useRef(makeValue);
  const lastEmittedModelRef = useRef(modelValue);
  const modelEditedRef = useRef(false);
  const modelTextRef = useRef(modelText);
  const variantRef = useRef(variant);

  const catalogueMake = useMemo(
    () => matchMake(makes, makeValue),
    [makeValue, makes],
  );
  const selectedMake = makeMode === "catalogue" ? catalogueMake : null;
  const fullModelValue = joinModelValue(modelText, variant);
  const variantMaxLength = getVariantMaxLength(modelText);
  const parsedModel = useMemo(
    () =>
      modelMode === "catalogue"
        ? parseModelValue(models, fullModelValue)
        : null,
    [fullModelValue, modelMode, models],
  );

  const emitModel = useCallback(
    (nextModel: string, nextVariant: string) => {
      const fullValue = joinModelValue(nextModel, nextVariant);
      lastEmittedModelRef.current = fullValue;
      onChange(modelAttribute.id, fullValue);
    },
    [modelAttribute.id, onChange],
  );

  function updateModelText(nextModel: string) {
    const nextVariant = variantRef.current.slice(
      0,
      getVariantMaxLength(nextModel),
    );
    modelTextRef.current = nextModel;
    variantRef.current = nextVariant;
    setModelText(nextModel);
    setVariant(nextVariant);
    if (!nextVariant && getVariantMaxLength(nextModel) === 0) {
      setVariantVisible(false);
    }
    emitModel(nextModel, nextVariant);
  }

  function updateVariant(nextVariant: string) {
    variantRef.current = nextVariant;
    setVariant(nextVariant);
    emitModel(modelTextRef.current, nextVariant);
  }

  useEffect(() => {
    if (makeValue === lastEmittedMakeRef.current) return;
    const matched = matchMake(makes, makeValue);
    setMakeMode(matched ? "catalogue" : "manual");
    setModelMode(matched ? "catalogue" : "manual");
  }, [makeValue, makes]);

  useEffect(() => {
    if (modelValue === lastEmittedModelRef.current) return;
    modelEditedRef.current = false;
    modelTextRef.current = modelValue;
    variantRef.current = "";
    setModelText(modelValue);
    setVariant("");
    setVariantVisible(false);
  }, [modelValue]);

  useEffect(() => {
    onSelectionChange({
      makeMode,
      modelMode,
      canonicalMake: selectedMake?.name,
      canonicalModel: parsedModel?.model.name,
      variant: parsedModel?.variant || undefined,
    });
  }, [
    makeMode,
    modelMode,
    onSelectionChange,
    parsedModel,
    selectedMake,
  ]);

  useEffect(() => {
    const requestToken = requestTokenRef.current + 1;
    requestTokenRef.current = requestToken;
    setModels([]);
    setModelsError(null);

    if (!selectedMake) {
      setModelsPending(false);
      return;
    }

    const activeMake = selectedMake;
    const controller = new AbortController();

    function reconcileModel(nextModels: VehicleModelOption[]) {
      const currentValue = joinModelValue(
        modelTextRef.current,
        variantRef.current,
      );
      if (!currentValue) return;
      const parsed = parseModelValue(nextModels, currentValue);
      if (parsed) {
        modelTextRef.current = parsed.model.name;
        variantRef.current = parsed.variant;
        setModelText(parsed.model.name);
        setVariant(parsed.variant);
        setVariantVisible(Boolean(parsed.variant));
        setModelMode("catalogue");
        emitModel(parsed.model.name, parsed.variant);
      } else if (!modelEditedRef.current) {
        setModelMode("manual");
      }
    }

    async function loadModels() {
      setModelsPending(true);
      const cached = cacheRef.current.get(activeMake.normalizedName);
      if (cached) {
        if (requestTokenRef.current !== requestToken) return;
        setModels(cached);
        reconcileModel(cached);
        setModelsPending(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/vehicle-catalogue/models?make=${encodeURIComponent(activeMake.name)}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Models could not be loaded.");
        const payload = (await response.json()) as {
          models?: VehicleModelOption[];
        };
        if (requestTokenRef.current !== requestToken) return;
        const nextModels = Array.isArray(payload.models) ? payload.models : [];
        cacheRef.current.set(activeMake.normalizedName, nextModels);
        setModels(nextModels);
        reconcileModel(nextModels);
      } catch {
        if (
          controller.signal.aborted ||
          requestTokenRef.current !== requestToken
        ) {
          return;
        }
        setModelsError("Models could not be loaded. Enter the model manually.");
        setModelMode("manual");
      } finally {
        if (requestTokenRef.current === requestToken) {
          setModelsPending(false);
        }
      }
    }

    void loadModels();
    return () => controller.abort();
  }, [emitModel, selectedMake]);

  function chooseMake(value: string) {
    const matchedMake = matchMake(makes, value);
    lastEmittedMakeRef.current = matchedMake?.name ?? value;
    onChange(makeAttribute.id, matchedMake?.name ?? value);
    modelEditedRef.current = false;
    modelTextRef.current = "";
    variantRef.current = "";
    setModelText("");
    setVariant("");
    setVariantVisible(false);
    emitModel("", "");
    if (matchedMake) {
      setMakeMode("catalogue");
      setModelMode("catalogue");
    } else if (makes.length === 0) {
      setMakeMode("manual");
      setModelMode("manual");
    }
  }

  function chooseModel(value: string) {
    modelEditedRef.current = true;
    const matchedModel = parseModelValue(models, value);
    if (matchedModel) {
      setModelMode("catalogue");
      updateModelText(matchedModel.model.name);
      if (matchedModel.variant) updateVariant(matchedModel.variant);
      return;
    }
    updateModelText(value);
  }

  function commitMake() {
    if (makeMode === "catalogue" && makeValue.trim() && !catalogueMake) {
      setMakeMode("manual");
      setModelMode("manual");
    }
  }

  function commitModel() {
    if (modelMode === "catalogue" && modelText.trim() && !parsedModel) {
      setModelMode("manual");
    }
  }

  const canShowModel = Boolean(makeValue.trim());

  return (
    <fieldset className="space-y-4">
      <legend className="sr-only">Vehicle make and model</legend>
      <div className="space-y-2">
        <Input
          id={`attr-${makeAttribute.id}`}
          name={`attr-${makeAttribute.id}`}
          label={makeMode === "manual" ? "Make (manual entry)" : makeAttribute.name}
          list={makeMode === "catalogue" ? "vehicle-make-options" : undefined}
          autoComplete="organization"
          required={required && makeAttribute.required}
          maxLength={80}
          value={makeValue}
          onChange={(event) => chooseMake(event.target.value)}
          onBlur={commitMake}
          placeholder={
            makeMode === "manual"
              ? "Enter manufacturer"
              : "Search or choose a make"
          }
          helperText={
            makeMode === "manual"
              ? "This make is not linked to the catalogue and will be saved as entered."
              : "Start typing to search the active manufacturer catalogue."
          }
          error={makeError}
          className="text-base sm:text-sm"
        />
        <datalist id="vehicle-make-options">
          {makes.map((make) => (
            <option key={make.id} value={make.name} />
          ))}
        </datalist>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const nextMode = makeMode === "manual" ? "catalogue" : "manual";
            setMakeMode(nextMode);
            setModelMode(nextMode);
          }}
        >
          {makeMode === "manual"
            ? "Choose from catalogue"
            : "Other / enter make manually"}
        </Button>
      </div>

      {canShowModel ? (
        <div className="space-y-2">
          <input
            type="hidden"
            name={`attr-${modelAttribute.id}`}
            value={fullModelValue}
          />
          <Input
            id={`attr-${modelAttribute.id}`}
            label={modelMode === "manual" ? "Model (manual entry)" : modelAttribute.name}
            list={modelMode === "catalogue" ? "vehicle-model-options" : undefined}
            autoComplete="off"
            required={required && modelAttribute.required}
            maxLength={80}
            value={modelText}
            onChange={(event) => chooseModel(event.target.value)}
            onBlur={commitModel}
            placeholder={
              modelsPending
                ? "Models are loading; you can keep typing"
                : modelMode === "manual"
                  ? "Enter model"
                  : "Search or choose a model"
            }
            helperText={
              modelsError ??
              (modelMode === "manual"
                ? "This model will be saved as entered."
                : models.length === 0 && !modelsPending
                  ? "No catalogue models found. Use manual entry."
                  : "Start typing to search models for the selected make.")
            }
            error={modelError}
            className="text-base sm:text-sm"
          />
          <datalist id="vehicle-model-options">
            {models.map((model) => (
              <option key={model.id} value={model.name} />
            ))}
          </datalist>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setModelMode((current) =>
                  current === "manual" ? "catalogue" : "manual",
                )
              }
            >
              {modelMode === "manual"
                ? "Choose from catalogue"
                : "Other / enter model manually"}
            </Button>
            {modelText.trim() && (variantVisible || variantMaxLength > 0) ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={variantVisible}
                onClick={() => setVariantVisible((current) => !current)}
              >
                {variantVisible ? "Hide variant / trim" : "Add variant / trim"}
              </Button>
            ) : null}
          </div>
          {variantVisible && variantMaxLength > 0 ? (
            <Input
              id="vehicle-variant"
              label="Variant / trim (optional)"
              maxLength={variantMaxLength}
              value={variant}
              onChange={(event) =>
                updateVariant(event.target.value.slice(0, variantMaxLength))
              }
              placeholder="e.g. R-Line or M Sport"
              helperText="Saved once after the canonical model name."
              className="text-base sm:text-sm"
            />
          ) : null}
          <p aria-live="polite" className="text-xs text-text-secondary">
            {modelsPending
              ? "Loading models…"
              : modelMode === "manual" && fullModelValue
                ? "Manual model entry selected."
                : parsedModel
                ? `Catalogue model selected: ${parsedModel.model.name}.`
                : fullModelValue
                  ? "Leave this field to save the unmatched model manually."
                  : "Choose a model to continue."}
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          {makeMode === "catalogue" && makeValue.trim()
            ? "Choose a make from the catalogue to reveal models."
            : "Choose or enter a make to reveal models."}
        </p>
      )}
    </fieldset>
  );
}
