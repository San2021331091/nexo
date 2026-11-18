import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/entities/catalog_item.dart';
import '../../domain/repositories/catalog_repository.dart';

class CatalogState {
  const CatalogState({
    this.channels = const [],
    this.trending = const [],
    this.searchResults = const [],
    this.categories = const [],
    this.saved = const [],
    this.feeds = const {},
    this.feedErrors = const {},
    this.loading = true,
    this.searching = false,
    this.error,
    this.query = '',
  });

  /// Every playable live channel.
  final List<CatalogItem> channels;

  /// Trending movies and series, interleaved, for Discover.
  final List<CatalogItem> trending;
  final List<CatalogItem> searchResults;
  final List<String> categories;
  final List<CatalogItem> saved;

  /// Home feeds keyed by tab id.
  final Map<String, HomeFeed> feeds;

  /// Tabs whose last load failed.
  final Set<String> feedErrors;
  final bool loading;
  final bool searching;
  final String? error;
  final String query;

  bool isSaved(CatalogItem item) => saved.any((value) => value.id == item.id);

  CatalogState copyWith({
    List<CatalogItem>? channels,
    List<CatalogItem>? trending,
    List<CatalogItem>? searchResults,
    List<String>? categories,
    List<CatalogItem>? saved,
    Map<String, HomeFeed>? feeds,
    Set<String>? feedErrors,
    bool? loading,
    bool? searching,
    String? error,
    bool clearError = false,
    String? query,
  }) =>
      CatalogState(
        channels: channels ?? this.channels,
        trending: trending ?? this.trending,
        searchResults: searchResults ?? this.searchResults,
        categories: categories ?? this.categories,
        saved: saved ?? this.saved,
        feeds: feeds ?? this.feeds,
        feedErrors: feedErrors ?? this.feedErrors,
        loading: loading ?? this.loading,
        searching: searching ?? this.searching,
        error: clearError ? null : error ?? this.error,
        query: query ?? this.query,
      );
}

class CatalogCubit extends Cubit<CatalogState> {
  CatalogCubit(this.repository) : super(const CatalogState());
  final CatalogRepository repository;

  /// Loads the device-local list, the channel directory and the first feed.
  Future<void> load() async {
    emit(state.copyWith(loading: true, clearError: true));
    emit(state.copyWith(saved: await repository.saved()));
    await Future.wait([_loadChannels(), loadFeed('all', force: true)]);
  }

  Future<void> _loadChannels() async {
    try {
      final values = await Future.wait<dynamic>([
        repository.channels(),
        repository.categories(),
      ]);
      final channels = (values[0] as List<CatalogItem>)
          .where((channel) => channel.isPlayable)
          .toList();
      final used = channels.map((channel) => channel.category).toSet();
      emit(state.copyWith(
        channels: channels,
        // Keep the operator's category order, then any category only channels use.
        categories: [
          ...(values[1] as List<String>).where(used.contains),
          ...used.where((name) => !(values[1] as List<String>).contains(name)),
        ],
        loading: false,
      ));
    } catch (_) {
      emit(state.copyWith(
        loading: false,
        error:
            'NEXO could not load live channels. Check your connection and retry.',
      ));
    }
  }

  Future<void> loadFeed(String tab, {bool force = false}) async {
    if (!force && state.feeds.containsKey(tab)) return;
    emit(state.copyWith(feedErrors: {...state.feedErrors}..remove(tab)));
    try {
      final feed = await repository.home(tab);
      emit(state.copyWith(feeds: {...state.feeds, tab: feed}));
    } catch (_) {
      emit(state.copyWith(feedErrors: {...state.feedErrors, tab}));
    }
  }

  Future<void> loadTrending() async {
    if (state.trending.isNotEmpty) return;
    try {
      final values = await Future.wait([
        repository.movies(list: 'trending'),
        repository.series(list: 'trending'),
      ]);
      final mixed = <CatalogItem>[];
      for (var index = 0; index < 12; index++) {
        if (index < values[0].length) mixed.add(values[0][index]);
        if (index < values[1].length) mixed.add(values[1][index]);
      }
      emit(state.copyWith(trending: mixed));
    } catch (_) {
      // Discover simply shows no trending rows; search still works.
    }
  }

  Future<void> search(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      emit(
          state.copyWith(query: '', searchResults: const [], searching: false));
      return;
    }
    emit(state.copyWith(query: trimmed, searching: true, clearError: true));
    try {
      final results = await repository.search(trimmed);
      // Ignore a slow response that a newer query has already replaced.
      if (state.query != trimmed) return;
      emit(state.copyWith(searchResults: results, searching: false));
    } catch (_) {
      if (state.query != trimmed) return;
      emit(state.copyWith(
          searching: false, error: 'Search could not be loaded right now.'));
    }
  }

  Future<CatalogItem?> loadMovieDetails(String slug) => repository.movie(slug);

  Future<FreeWatchOptions> freeWatchOptions(
          {required String type, required String slug, String? region}) =>
      repository.freeWatchOptions(type: type, slug: slug, region: region);

  Future<({CatalogItem? series, List<CatalogSeason> seasons})> loadSeriesPage(
      String slug) async {
    final values = await Future.wait<dynamic>([
      repository.seriesDetails(slug),
      repository.seasons(slug),
    ]);
    return (
      series: values[0] as CatalogItem?,
      seasons: values[1] as List<CatalogSeason>
    );
  }

  Future<void> toggle(CatalogItem item) async {
    if (state.isSaved(item)) {
      await repository.remove(item.id);
    } else {
      await repository.save(item);
    }
    emit(state.copyWith(saved: await repository.saved()));
  }

  Future<void> refresh() => load();
}
