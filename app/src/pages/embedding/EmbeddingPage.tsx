import {
  memo,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  graphql,
  PreloadedQuery,
  useLazyLoadQuery,
  usePreloadedQuery,
  useQueryLoader,
} from "react-relay";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { subDays } from "date-fns";
import useDeepCompareEffect from "use-deep-compare-effect";
import { css } from "@emotion/react";

import { Switch } from "@arizeai/components";
import { ThreeDimensionalPoint } from "@arizeai/point-cloud";

import {
  Counter,
  Flex,
  Loading,
  LoadingMask,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  View,
} from "@phoenix/components";
import {
  PrimaryInferencesTimeRange,
  ReferenceInferencesTimeRange,
  Toolbar,
} from "@phoenix/components/filter";
import {
  ClusterItem,
  PointCloud,
  PointCloudParameterSettings,
} from "@phoenix/components/pointcloud";
import ClusteringSettings from "@phoenix/components/pointcloud/ClusteringSettings";
import { PointCloudDisplaySettings } from "@phoenix/components/pointcloud/PointCloudDisplaySettings";
import {
  compactResizeHandleCSS,
  resizeHandleCSS,
} from "@phoenix/components/resize/styles";
import {
  PointCloudProvider,
  useGlobalNotification,
  useInferences,
  usePointCloudContext,
} from "@phoenix/contexts";
import { useTimeRange } from "@phoenix/contexts/TimeRangeContext";
import {
  TimeSliceContextProvider,
  useTimeSlice,
} from "@phoenix/contexts/TimeSliceContext";
import { useEmbeddingDimensionId } from "@phoenix/hooks/useEmbeddingDimensionId";
import {
  ClusterColorMode,
  getDefaultDriftPointCloudProps,
  getDefaultRetrievalTroubleshootingPointCloudProps,
  getDefaultSingleInferenceSetPointCloudProps,
  MetricDefinition,
  PointCloudProps,
} from "@phoenix/store";
import { assertUnreachable } from "@phoenix/typeUtils";
import { getMetricShortNameByMetricKey } from "@phoenix/utils/metricFormatUtils";

import { EmbeddingPageModelQuery } from "./__generated__/EmbeddingPageModelQuery.graphql";
import {
  EmbeddingPageUMAPQuery as UMAPQueryType,
  EmbeddingPageUMAPQuery$data,
} from "./__generated__/EmbeddingPageUMAPQuery.graphql";
import { ClusterSortPicker } from "./ClusterSortPicker";
import { MetricSelector } from "./MetricSelector";
import { MetricTimeSeries } from "./MetricTimeSeries";
import { PointSelectionPanelContent } from "./PointSelectionPanelContent";

type UMAPPointsEntry = NonNullable<
  EmbeddingPageUMAPQuery$data["embedding"]["UMAPPoints"]
>["data"][number];

const EmbeddingPageUMAPQuery = graphql`
  query EmbeddingPageUMAPQuery(
    $id: ID!
    $timeRange: TimeRange!
    $minDist: Float!
    $nNeighbors: Int!
    $nSamples: Int!
    $minClusterSize: Int!
    $clusterMinSamples: Int!
    $clusterSelectionEpsilon: Float!
    $fetchDataQualityMetric: Boolean!
    $dataQualityMetricColumnName: String
    $fetchPerformanceMetric: Boolean!
    $performanceMetric: PerformanceMetric!
  ) {
    embedding: node(id: $id) {
      ... on EmbeddingDimension {
        UMAPPoints(
          timeRange: $timeRange
          minDist: $minDist
          nNeighbors: $nNeighbors
          nSamples: $nSamples
          minClusterSize: $minClusterSize
          clusterMinSamples: $clusterMinSamples
          clusterSelectionEpsilon: $clusterSelectionEpsilon
        ) {
          data {
            id
            eventId
            coordinates {
              __typename
              ... on Point3D {
                x
                y
                z
              }
              ... on Point2D {
                x
                y
              }
            }
            embeddingMetadata {
              linkToData
              rawData
            }
            eventMetadata {
              predictionId
              predictionLabel
              actualLabel
              predictionScore
              actualScore
            }
          }
          referenceData {
            id
            eventId
            coordinates {
              __typename
              ... on Point3D {
                x
                y
                z
              }
              ... on Point2D {
                x
                y
              }
            }
            embeddingMetadata {
              linkToData
              rawData
            }
            eventMetadata {
              predictionId
              predictionLabel
              actualLabel
              predictionScore
              actualScore
            }
          }
          corpusData {
            id
            eventId
            coordinates {
              __typename
              ... on Point3D {
                x
                y
                z
              }
              ... on Point2D {
                x
                y
              }
            }
            embeddingMetadata {
              linkToData
              rawData
            }
            eventMetadata {
              predictionId
              predictionLabel
              actualLabel
              predictionScore
              actualScore
            }
          }
          clusters {
            id
            eventIds
            driftRatio
            primaryToCorpusRatio
            dataQualityMetric(
              metric: { columnName: $dataQualityMetricColumnName, metric: mean }
            ) @include(if: $fetchDataQualityMetric) {
              primaryValue
              referenceValue
            }
            performanceMetric(metric: { metric: $performanceMetric })
              @include(if: $fetchPerformanceMetric) {
              primaryValue
              referenceValue
            }
          }
          contextRetrievals {
            queryId
            documentId
            relevance
          }
        }
      }
    }
  }
`;

export function EmbeddingPage() {
  const { referenceInferences, corpusInferences } = useInferences();
  const { timeRange } = useTimeRange();
  // Initialize the store based on whether or not there is a reference inferences
  const defaultPointCloudProps = useMemo<Partial<PointCloudProps>>(() => {
    let defaultPointCloudProps: Partial<PointCloudProps> = {};
    if (corpusInferences != null) {
      // If there is a corpus inferencescesces, then initialize the page with the retrieval troubleshooting settings
      // TODO - this does make a bit of a leap of assumptions but is a short term solution in order to get the page working as intended
      defaultPointCloudProps =
        getDefaultRetrievalTroubleshootingPointCloudProps();
    } else if (referenceInferences != null) {
      defaultPointCloudProps = getDefaultDriftPointCloudProps();
    } else {
      defaultPointCloudProps = getDefaultSingleInferenceSetPointCloudProps();
    }

    // Apply the UMAP parameters from the server-sent config
    defaultPointCloudProps = {
      ...defaultPointCloudProps,
      umapParameters: {
        ...window.Config.UMAP,
      },
    };
    return defaultPointCloudProps;
  }, [corpusInferences, referenceInferences]);
  return (
    <TimeSliceContextProvider initialTimestamp={timeRange.end}>
      <PointCloudProvider {...defaultPointCloudProps}>
        <EmbeddingMain />
      </PointCloudProvider>
    </TimeSliceContextProvider>
  );
}

function EmbeddingMain() {
  const embeddingDimensionId = useEmbeddingDimensionId();
  const { primaryInferences, referenceInferences } = useInferences();
  const umapParameters = usePointCloudContext((state) => state.umapParameters);
  const getHDSCANParameters = usePointCloudContext(
    (state) => state.getHDSCANParameters
  );
  const getMetric = usePointCloudContext((state) => state.getMetric);
  const resetPointCloud = usePointCloudContext((state) => state.reset);
  const setLoading = usePointCloudContext((state) => state.setLoading);
  const [showChart, setShowChart] = useState<boolean>(true);
  const [queryReference, loadQuery, disposeQuery] =
    useQueryLoader<UMAPQueryType>(EmbeddingPageUMAPQuery);
  const { selectedTimestamp } = useTimeSlice();
  const endTime = useMemo(
    () => selectedTimestamp ?? new Date(primaryInferences.endTime),
    [selectedTimestamp, primaryInferences.endTime]
  );
  const timeRange = useMemo(() => {
    return {
      start: subDays(endTime, 2).toISOString(),
      end: endTime.toISOString(),
    };
  }, [endTime]);

  // Additional data needed for the page
  const modelData = useLazyLoadQuery<EmbeddingPageModelQuery>(
    graphql`
      query EmbeddingPageModelQuery {
        model {
          ...MetricSelector_dimensions
        }
      }
    `,
    {}
  );

  useEffect(() => {
    // dispose of the selections in the context
    resetPointCloud();
    setLoading(true);
    const metric = getMetric();
    loadQuery(
      {
        id: embeddingDimensionId,
        timeRange,
        ...umapParameters,
        ...getHDSCANParameters(),
        fetchDataQualityMetric: metric.type === "dataQuality",
        fetchPerformanceMetric: metric.type === "performance",
        dataQualityMetricColumnName:
          metric.type === "dataQuality" ? metric.dimension.name : null,
        performanceMetric:
          metric.type === "performance" ? metric.metric : "accuracyScore", // Note that the fallback should never happen but is to satisfy the type checker
      },
      {
        fetchPolicy: "network-only",
      }
    );
    return () => {
      disposeQuery();
    };
  }, [
    setLoading,
    resetPointCloud,
    embeddingDimensionId,
    loadQuery,
    disposeQuery,
    umapParameters,
    getHDSCANParameters,
    getMetric,
    timeRange,
  ]);

  return (
    <main
      css={css`
        flex: 1 1 auto;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      `}
    >
      <PointCloudNotifications />
      <Toolbar
        extra={
          <Switch
            onChange={(isSelected) => {
              setShowChart(isSelected);
            }}
            isSelected={showChart}
            labelPlacement="start"
          >
            Show Timeseries
          </Switch>
        }
      >
        <PrimaryInferencesTimeRange />
        {referenceInferences ? (
          <ReferenceInferencesTimeRange
            inferencesRole="reference"
            timeRange={{
              start: new Date(referenceInferences.startTime),
              end: new Date(referenceInferences.endTime),
            }}
          />
        ) : null}
        <MetricSelector model={modelData.model} />
      </Toolbar>
      <PanelGroup direction="vertical">
        {showChart ? (
          <>
            <Panel defaultSize={20} collapsible order={1}>
              <Suspense fallback={<Loading />}>
                <MetricTimeSeries embeddingDimensionId={embeddingDimensionId} />
              </Suspense>
            </Panel>
            <PanelResizeHandle css={resizeHandleCSS} />
          </>
        ) : null}
        <Panel order={2}>
          <div
            css={css`
              width: 100%;
              height: 100%;
              position: relative;
            `}
          >
            <Suspense fallback={<LoadingMask />}>
              {queryReference ? (
                <PointCloudDisplay queryReference={queryReference} />
              ) : null}
            </Suspense>
          </div>
        </Panel>
      </PanelGroup>
    </main>
  );
}

function coordinatesToThreeDimensionalPoint(
  coordinates: UMAPPointsEntry["coordinates"]
): ThreeDimensionalPoint {
  if (coordinates.__typename !== "Point3D") {
    throw new Error(
      `Expected Point3D but got ${coordinates.__typename} for coordinates`
    );
  }
  return [coordinates.x, coordinates.y, coordinates.z];
}

/**
 * Fetches the umap data for the embedding dimension and passes the data to the point cloud
 */
function PointCloudDisplay({
  queryReference,
}: {
  queryReference: PreloadedQuery<UMAPQueryType>;
}) {
  const data = usePreloadedQuery<UMAPQueryType>(
    EmbeddingPageUMAPQuery,
    queryReference
  );

  const sourceData = useMemo(
    () => data.embedding?.UMAPPoints?.data ?? [],
    [data]
  );
  const referenceSourceData = useMemo(
    () => data.embedding?.UMAPPoints?.referenceData ?? [],
    [data]
  );
  const corpusSourceData = useMemo(
    () => data.embedding?.UMAPPoints?.corpusData ?? [],
    [data]
  );

  const contextRetrievals = useMemo(() => {
    return data.embedding?.UMAPPoints?.contextRetrievals ?? [];
  }, [data]);

  // Construct a map of point ids to their data
  const allSourceData = useMemo(() => {
    const allData = [
      ...sourceData,
      ...referenceSourceData,
      ...corpusSourceData,
    ];

    return allData.map((d) => ({
      ...d,
      position: coordinatesToThreeDimensionalPoint(d.coordinates),
      metaData: {
        id: d.eventId,
      },
    }));
  }, [referenceSourceData, sourceData, corpusSourceData]);

  // Keep the data in the view in-sync with the data in the context
  const setInitialData = usePointCloudContext((state) => state.setInitialData);
  const setClusters = usePointCloudContext((state) => state.setClusters);

  useDeepCompareEffect(() => {
    const clusters = data.embedding?.UMAPPoints?.clusters || [];
    setInitialData({
      points: allSourceData,
      clusters,
      retrievals: contextRetrievals,
    });
  }, [
    allSourceData,
    queryReference,
    contextRetrievals,
    setInitialData,
    setClusters,
  ]);

  return (
    <div
      css={css`
        flex: 1 1 auto;
        display: flex;
        flex-direction: row;
        align-items: stretch;
        width: 100%;
        height: 100%;
      `}
      data-testid="point-cloud-display"
    >
      <PanelGroup direction="horizontal">
        <Panel
          id="embedding-left"
          defaultSize={15}
          maxSize={30}
          minSize={10}
          collapsible
        >
          <PanelGroup
            autoSaveId="embedding-controls-vertical"
            direction="vertical"
          >
            <Panel
              css={css`
                display: flex;
                flex-direction: column;
                .ac-tabs {
                  height: 100%;
                  overflow: hidden;
                  display: flex;
                  flex-direction: column;
                  [role="tablist"] {
                    flex: none;
                  }
                  .ac-tabs__pane-container {
                    flex: 1 1 auto;
                    overflow: hidden;
                    display: flex;
                    flex-direction: column;
                    & > div {
                      height: 100%;
                    }
                  }
                }
              `}
            >
              <ClustersPanelContents />
            </Panel>
            <PanelResizeHandle css={resizeHandleCSS} />
            <Panel
              css={css`
                .ac-tabs {
                  height: 100%;
                  overflow: hidden;
                  .ac-tabs__pane-container {
                    height: 100%;
                    overflow-y: auto;
                  }
                }
              `}
            >
              <Tabs>
                <TabList>
                  <Tab id="display">Display</Tab>
                  <Tab id="hyperparameters">Hyperparameters</Tab>
                </TabList>
                <TabPanel id="display">
                  <PointCloudDisplaySettings />
                </TabPanel>
                <TabPanel id="hyperparameters">
                  <PointCloudParameterSettings />
                </TabPanel>
              </Tabs>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle css={compactResizeHandleCSS} />
        <Panel>
          <div
            css={css`
              position: relative;
              width: 100%;
              height: 100%;
            `}
          >
            <SelectionPanel />
            <PointCloud />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

function SelectionPanel() {
  const selectedEventIds = usePointCloudContext(
    (state) => state.selectedEventIds
  );

  if (selectedEventIds.size === 0) {
    return null;
  }

  return (
    <div
      css={css`
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        right: 0;
      `}
      data-testid="selection-panel"
    >
      <PanelGroup direction="vertical">
        <Panel></Panel>
        <PanelResizeHandle css={resizeHandleCSS} style={{ zIndex: 1 }} />
        <Panel
          id="embedding-point-selection"
          defaultSize={40}
          minSize={20}
          order={2}
          style={{ zIndex: 1 }}
        >
          <PointSelectionPanelContentWrap>
            <Suspense fallback={<Loading />}>
              <PointSelectionPanelContent />
            </Suspense>
          </PointSelectionPanelContentWrap>
        </Panel>
      </PanelGroup>
    </div>
  );
}

/**
 * Wraps the content of the point selection panel so that it can be styled
 */
function PointSelectionPanelContentWrap(props: { children: ReactNode }) {
  return (
    <div
      css={css`
        background-color: var(--ac-global-color-grey-75);
        width: 100%;
        height: 100%;
      `}
    >
      {props.children}
    </div>
  );
}

const ClustersPanelContents = memo(function ClustersPanelContents() {
  const { referenceInferences } = useInferences();
  const clusters = usePointCloudContext((state) => state.clusters);
  const selectedClusterId = usePointCloudContext(
    (state) => state.selectedClusterId
  );
  const metric = usePointCloudContext((state) => state.metric);
  const setSelectedClusterId = usePointCloudContext(
    (state) => state.setSelectedClusterId
  );
  const setSelectedEventIds = usePointCloudContext(
    (state) => state.setSelectedEventIds
  );
  const setHighlightedClusterId = usePointCloudContext(
    (state) => state.setHighlightedClusterId
  );
  const setClusterColorMode = usePointCloudContext(
    (state) => state.setClusterColorMode
  );
  // Hide the reference metric if the following conditions are met:
  // 1. There is no reference inferences
  // 3. The metric is drift
  const hideReference = referenceInferences == null || metric.type === "drift";
  const onTabChange = useCallback(
    (key: string) => {
      if (key === "configuration") {
        setClusterColorMode(ClusterColorMode.highlight);
      } else {
        setClusterColorMode(ClusterColorMode.default);
      }
    },
    [setClusterColorMode]
  );

  return (
    <Tabs onSelectionChange={(key) => onTabChange(key as string)}>
      <TabList>
        <Tab id="clusters">
          Clusters <Counter>{clusters.length}</Counter>
        </Tab>
        <Tab id="configuration">Configuration</Tab>
      </TabList>
      <TabPanel id="clusters">
        <Flex direction="column" height="100%">
          <View
            borderBottomColor="dark"
            borderBottomWidth="thin"
            backgroundColor="dark"
            flex="none"
            padding="size-50"
          >
            <Flex direction="row" justifyContent="end">
              <ClusterSortPicker />
            </Flex>
          </View>
          <View flex="1 1 auto" overflow="auto">
            <ul
              css={css`
                flex: 1 1 auto;
                display: flex;
                flex-direction: column;
                gap: var(--ac-global-dimension-size-100);
                margin: var(--ac-global-dimension-size-100);
              `}
            >
              {clusters.map((cluster) => {
                return (
                  <li key={cluster.id}>
                    <ClusterItem
                      clusterId={cluster.id}
                      numPoints={cluster.eventIds.length}
                      isSelected={selectedClusterId === cluster.id}
                      driftRatio={cluster.driftRatio}
                      primaryToCorpusRatio={cluster.primaryToCorpusRatio}
                      primaryMetricValue={cluster.primaryMetricValue}
                      referenceMetricValue={cluster.referenceMetricValue}
                      metricName={getClusterMetricName(metric)}
                      hideReference={hideReference}
                      onClick={() => {
                        if (selectedClusterId !== cluster.id) {
                          setSelectedClusterId(cluster.id);
                          setSelectedEventIds(new Set(cluster.eventIds));
                        } else {
                          setSelectedClusterId(null);
                          setSelectedEventIds(new Set());
                        }
                      }}
                      onMouseEnter={() => {
                        setHighlightedClusterId(cluster.id);
                      }}
                      onMouseLeave={() => {
                        setHighlightedClusterId(null);
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          </View>
        </Flex>
      </TabPanel>
      <TabPanel id="configuration">
        <View overflow="auto" height="100%">
          <ClusteringSettings />
        </View>
      </TabPanel>
    </Tabs>
  );
});

function getClusterMetricName(metric: MetricDefinition): string {
  const { type: metricType, metric: metricEnum } = metric;
  switch (metricType) {
    case "dataQuality":
      return `${metric.dimension.name} avg`;
    case "drift": {
      switch (metricEnum) {
        case "euclideanDistance":
          return "Cluster Drift";

        default:
          assertUnreachable(metricEnum);
      }
      break;
    }
    case "performance":
      return getMetricShortNameByMetricKey(metricEnum);
    case "retrieval": {
      switch (metricEnum) {
        case "queryDistance":
          return "% Query";
        default:
          assertUnreachable(metricEnum);
      }
      break;
    }
    default:
      assertUnreachable(metricType);
  }
}

function PointCloudNotifications() {
  const { notifyError } = useGlobalNotification();
  const errorMessage = usePointCloudContext((state) => state.errorMessage);
  const setErrorMessage = usePointCloudContext(
    (state) => state.setErrorMessage
  );

  useEffect(() => {
    if (errorMessage !== null) {
      notifyError({
        title: "An error occurred",
        message: errorMessage,
        action: {
          text: "Dismiss",
          onClick: () => {
            setErrorMessage(null);
          },
        },
      });
    }
  }, [errorMessage, notifyError, setErrorMessage]);

  return null;
}
