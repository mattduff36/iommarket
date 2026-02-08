"use client";

import * as React from "react";

/* ---- UI primitives ---- */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

/* ---- Marketplace ---- */
import { ListingCard } from "@/components/marketplace/listing-card";
import { SearchBar } from "@/components/marketplace/search-bar";
import { FilterPanel } from "@/components/marketplace/filter-panel";

/* ---- Icons ---- */
import { ChevronDown, Plus, Search as SearchIcon } from "lucide-react";

/* ================================================================== */
/*  Section wrapper                                                   */
/* ================================================================== */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold text-text-primary border-b border-border pb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {label}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/* ================================================================== */
/*  Page                                                              */
/* ================================================================== */

export default function StyleguidePage() {
  const [page, setPage] = React.useState(3);
  const [sliderVal, setSliderVal] = React.useState([2500, 7500]);
  const [searchVal, setSearchVal] = React.useState("");
  const [cats, setCats] = React.useState<string[]>([]);
  const [conds, setConds] = React.useState<string[]>([]);
  const [priceRange, setPriceRange] = React.useState<[number, number]>([0, 10000]);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-[1100] flex h-16 items-center border-b border-border bg-surface px-6">
        <h1 className="text-lg font-bold text-text-primary">
          IOM Market – Styleguide
        </h1>
      </header>

      <main className="mx-auto max-w-5xl space-y-12 px-6 py-10">
        {/* ---- Colour palette ---- */}
        <Section title="Colour Palette">
          <Row label="Slate">
            {["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"].map(
              (s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                  <div
                    className="h-10 w-10 rounded-md border border-border"
                    style={{ backgroundColor: `var(--color-slate-${s})` }}
                  />
                  <span className="text-[10px] text-text-secondary">{s}</span>
                </div>
              ),
            )}
          </Row>
          <Row label="Royal Blue">
            {["50", "100", "500", "600", "700", "800"].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <div
                  className="h-10 w-10 rounded-md border border-border"
                  style={{ backgroundColor: `var(--color-royalBlue-${s})` }}
                />
                <span className="text-[10px] text-text-secondary">{s}</span>
              </div>
            ))}
          </Row>
          <Row label="Status">
            {[
              { name: "Success", bg: "var(--sem-status-success-bg)", text: "var(--sem-status-success-text)" },
              { name: "Error", bg: "var(--sem-status-error-bg)", text: "var(--sem-status-error-text)" },
              { name: "Warning", bg: "var(--sem-status-warning-bg)", text: "var(--sem-status-warning-text)" },
              { name: "Info", bg: "var(--sem-status-info-bg)", text: "var(--sem-status-info-text)" },
            ].map((s) => (
              <div
                key={s.name}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium"
                style={{ backgroundColor: s.bg, color: s.text }}
              >
                {s.name}
              </div>
            ))}
          </Row>
        </Section>

        {/* ---- Typography ---- */}
        <Section title="Typography">
          <div className="space-y-2">
            <p className="text-3xl font-bold">Heading 3xl (30px bold)</p>
            <p className="text-2xl font-semibold">Heading 2xl (24px semibold)</p>
            <p className="text-xl font-semibold">Heading xl (20px semibold)</p>
            <p className="text-lg font-medium">Heading lg (18px medium)</p>
            <p className="text-base">Body base (16px regular)</p>
            <p className="text-sm text-text-secondary">Body sm (14px secondary)</p>
            <p className="text-xs text-text-tertiary">Caption xs (12px tertiary)</p>
          </div>
        </Section>

        {/* ---- Buttons ---- */}
        <Section title="Button">
          <Row label="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="link">Link</Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button size="icon"><Plus className="h-4 w-4" /></Button>
          </Row>
          <Row label="States">
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </Row>
        </Section>

        {/* ---- Input ---- */}
        <Section title="Input">
          <div className="grid max-w-md gap-4">
            <Input label="Default" placeholder="Enter text..." />
            <Input label="With helper" placeholder="Email" helperText="We'll never share your email." />
            <Input label="Error state" placeholder="Username" error="Username is already taken" />
            <Input label="Disabled" placeholder="Disabled" disabled />
          </div>
        </Section>

        {/* ---- Select ---- */}
        <Section title="Select">
          <div className="max-w-xs">
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Choose a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cars">Cars</SelectItem>
                <SelectItem value="property">Property</SelectItem>
                <SelectItem value="electronics">Electronics</SelectItem>
                <SelectItem value="furniture">Furniture</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Section>

        {/* ---- Checkbox ---- */}
        <Section title="Checkbox">
          <Row>
            <Checkbox label="Accept terms" />
            <Checkbox label="Checked" defaultChecked />
            <Checkbox label="Disabled" disabled />
          </Row>
        </Section>

        {/* ---- Switch ---- */}
        <Section title="Switch">
          <Row>
            <Switch label="Notifications" />
            <Switch label="Active" defaultChecked />
            <Switch label="Disabled" disabled />
          </Row>
        </Section>

        {/* ---- Slider ---- */}
        <Section title="Slider">
          <div className="max-w-md space-y-2">
            <Slider
              min={0}
              max={10000}
              step={100}
              value={sliderVal}
              onValueChange={setSliderVal}
            />
            <div className="flex justify-between text-xs text-text-secondary">
              <span>£{sliderVal[0].toLocaleString()}</span>
              <span>£{sliderVal[1].toLocaleString()}</span>
            </div>
          </div>
        </Section>

        {/* ---- Badge ---- */}
        <Section title="Badge">
          <Row>
            <Badge variant="success">Active</Badge>
            <Badge variant="error">Expired</Badge>
            <Badge variant="warning">Pending</Badge>
            <Badge variant="info">New</Badge>
            <Badge variant="neutral">Draft</Badge>
          </Row>
        </Section>

        {/* ---- Card ---- */}
        <Section title="Card">
          <div className="max-w-sm">
            <Card>
              <CardHeader>
                <CardTitle>Card Title</CardTitle>
                <CardDescription>Supporting description text.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-text-secondary">
                  Card body content goes here. Can include any elements.
                </p>
              </CardContent>
              <CardFooter className="gap-2">
                <Button size="sm">Action</Button>
                <Button size="sm" variant="secondary">Cancel</Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        {/* ---- Dialog ---- */}
        <Section title="Dialog">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="secondary">Open Dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Action</DialogTitle>
                <DialogDescription>
                  Are you sure you want to proceed? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="secondary">Cancel</Button>
                <Button>Confirm</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </Section>

        {/* ---- Dropdown Menu ---- */}
        <Section title="Dropdown Menu">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">
                Options <ChevronDown className="ml-1 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem>Edit Listing</DropdownMenuItem>
              <DropdownMenuItem>Duplicate</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600">Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>

        {/* ---- Tabs ---- */}
        <Section title="Tabs">
          <Tabs defaultValue="all">
            <TabsList>
              <TabsTrigger value="all">All Items</TabsTrigger>
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="sold">Sold</TabsTrigger>
            </TabsList>
            <TabsContent value="all">
              <p className="text-sm text-text-secondary p-4 rounded-md bg-surface border border-border">
                Showing all items.
              </p>
            </TabsContent>
            <TabsContent value="active">
              <p className="text-sm text-text-secondary p-4 rounded-md bg-surface border border-border">
                Showing active items.
              </p>
            </TabsContent>
            <TabsContent value="sold">
              <p className="text-sm text-text-secondary p-4 rounded-md bg-surface border border-border">
                Showing sold items.
              </p>
            </TabsContent>
          </Tabs>
        </Section>

        {/* ---- Table ---- */}
        <Section title="Table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { item: "Vintage Watch", cat: "Accessories", price: "£1,200", status: "success" as const },
                { item: "Oak Dining Table", cat: "Furniture", price: "£850", status: "info" as const },
                { item: "Mountain Bike", cat: "Sports", price: "£450", status: "warning" as const },
              ].map((row) => (
                <TableRow key={row.item}>
                  <TableCell className="font-medium">{row.item}</TableCell>
                  <TableCell>{row.cat}</TableCell>
                  <TableCell>{row.price}</TableCell>
                  <TableCell>
                    <Badge variant={row.status}>
                      {row.status === "success" ? "Active" : row.status === "info" ? "New" : "Pending"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        {/* ---- Pagination ---- */}
        <Section title="Pagination">
          <Pagination currentPage={page} totalPages={12} onPageChange={setPage} />
        </Section>

        {/* ---- Alert ---- */}
        <Section title="Alert">
          <div className="space-y-3 max-w-lg">
            <Alert status="success">Your listing has been published.</Alert>
            <Alert status="error" onClose={() => {}}>
              Failed to upload image. Please try again.
            </Alert>
            <Alert status="info">
              New feature: You can now schedule listings.
            </Alert>
            <Alert status="warning">
              Your subscription expires in 3 days.
            </Alert>
          </div>
        </Section>

        {/* ---- Skeleton ---- */}
        <Section title="Skeleton">
          <div className="flex flex-col gap-3 max-w-sm">
            <Skeleton className="h-40 w-full" />
            <Skeleton variant="text" className="w-3/4" />
            <Skeleton variant="text" className="w-1/2" />
            <div className="flex gap-3">
              <Skeleton variant="circle" className="h-10 w-10" />
              <div className="flex-1 space-y-2">
                <Skeleton variant="text" />
                <Skeleton variant="text" className="w-2/3" />
              </div>
            </div>
          </div>
        </Section>

        {/* ---- Empty State ---- */}
        <Section title="Empty State">
          <EmptyState
            title="No listings found"
            description="Try adjusting your filters or create a new listing."
            action={
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Create Listing
              </Button>
            }
          />
        </Section>

        {/* ================================================================== */}
        {/*  MARKETPLACE COMPONENTS                                            */}
        {/* ================================================================== */}

        <div className="pt-8 border-t border-border">
          <h2 className="text-2xl font-bold text-text-primary mb-8">
            Marketplace Components
          </h2>
        </div>

        {/* ---- SearchBar ---- */}
        <Section title="SearchBar">
          <div className="max-w-md">
            <SearchBar
              placeholder="Search marketplace..."
              value={searchVal}
              onValueChange={setSearchVal}
            />
          </div>
        </Section>

        {/* ---- ListingCard ---- */}
        <Section title="ListingCard">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <ListingCard
              title="Vintage Rolex Submariner 1968"
              price={12500}
              location="Douglas, IOM"
              meta="Listed 2 days ago"
              badge="Featured"
              featured
            />
            <ListingCard
              title="Victorian Oak Writing Desk"
              price={850}
              location="Ramsey, IOM"
              meta="Listed 1 week ago"
            />
            <ListingCard
              title="Mountain Bike – Canyon Spectral"
              price={2200}
              location="Peel, IOM"
              meta="Listed 3 days ago"
              badge="New"
            />
          </div>
        </Section>

        {/* ---- FilterPanel ---- */}
        <Section title="FilterPanel">
          <div className="rounded-lg border border-border bg-surface p-4">
            <FilterPanel
              categories={[
                { label: "Vehicles", value: "vehicles", count: 142 },
                { label: "Property", value: "property", count: 87 },
                { label: "Electronics", value: "electronics", count: 231 },
                { label: "Furniture", value: "furniture", count: 64 },
              ]}
              selectedCategories={cats}
              onCategoryChange={setCats}
              conditions={[
                { label: "New", value: "new", count: 312 },
                { label: "Like New", value: "like-new", count: 189 },
                { label: "Used", value: "used", count: 456 },
              ]}
              selectedConditions={conds}
              onConditionChange={setConds}
              priceRange={priceRange}
              priceMin={0}
              priceMax={10000}
              onPriceChange={setPriceRange}
              onReset={() => {
                setCats([]);
                setConds([]);
                setPriceRange([0, 10000]);
              }}
            />
          </div>
        </Section>

        {/* ---- Marketplace Grid Layout Demo ---- */}
        <Section title="Marketplace Grid Layout">
          <p className="text-sm text-text-secondary mb-4">
            280px sidebar + responsive auto-fill grid (per design-system.json layout pattern).
          </p>
          <div className="flex gap-6">
            <div className="shrink-0 rounded-lg border border-border bg-surface p-4">
              <FilterPanel
                categories={[
                  { label: "Vehicles", value: "vehicles", count: 142 },
                  { label: "Property", value: "property", count: 87 },
                ]}
                selectedCategories={[]}
                conditions={[
                  { label: "New", value: "new" },
                  { label: "Used", value: "used" },
                ]}
                selectedConditions={[]}
              />
            </div>
            <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
              {[
                { t: "Classic MG Roadster", p: 18500, loc: "Douglas" },
                { t: "Seascape Oil Painting", p: 340, loc: "Port Erin" },
                { t: "Antique Grandfather Clock", p: 2100, loc: "Castletown" },
                { t: "Drone – DJI Mini 4 Pro", p: 699, loc: "Onchan" },
              ].map((item) => (
                <ListingCard
                  key={item.t}
                  title={item.t}
                  price={item.p}
                  location={`${item.loc}, IOM`}
                />
              ))}
            </div>
          </div>
        </Section>
      </main>
    </div>
  );
}
