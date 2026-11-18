import '../entities/catalog_item.dart';

abstract interface class CatalogRepository {
  /// The sectioned feed for a home tab: `all`, `live`, `sports`, `movies`,
  /// `series`, or `dramas`.
  Future<HomeFeed> home(String tab);
  Future<List<CatalogItem>> channels({String query = '', String category = ''});
  Future<List<CatalogItem>> movies(
      {String query = '',
      String genre = '',
      String language = '',
      String list = '',
      int? year,
      int page = 1});
  Future<List<CatalogItem>> series(
      {String query = '',
      String genre = '',
      String language = '',
      String list = '',
      int? year,
      int page = 1});
  Future<List<CatalogItem>> search(String query);
  Future<CatalogItem?> movie(String slug);
  Future<CatalogItem?> seriesDetails(String slug);
  Future<List<CatalogSeason>> seasons(String slug);
  Future<List<String>> categories();

  /// The channel's YouTube live stream, or null when it has none right now.
  /// Used as a fallback when the channel's own stream cannot be played.
  Future<String?> channelYoutubeLive(String slug);

  /// Numbered playback servers for a TMDB movie or episode; empty when the
  /// title has none or the request fails.
  Future<List<PlaybackServer>> playbackSources(
      {required String type, required int tmdbId, int? season, int? episode});
  Future<List<CatalogItem>> saved();
  Future<void> save(CatalogItem item);
  Future<void> remove(String id);
}
