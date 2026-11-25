' Small, bounded HTML reader; failures return the IMDb link, never invented reviews.
function lcHtmlText(html as String) as String
  text = CreateObject("roRegex", "<[^>]*>", "i").ReplaceAll(html, " ")
  text = text.Replace("&amp;", "&").Replace("&quot;", Chr(34)).Replace("&#39;", "'").Replace("&apos;", "'").Replace("&lt;", "<").Replace("&gt;", ">").Replace("&nbsp;", " ")
  return CreateObject("roRegex", "\s+", "").ReplaceAll(text, " ").Trim()
end function

function lcReviews(id as String) as Object
  valid = CreateObject("roRegex", "^tt[0-9]+$", "").IsMatch(id)
  if not valid then return { reviews: [] }
  cached = lcReadTmpJson("tvm_reviews_" + id + ".json", 86400)
  if cached <> invalid then return cached
  meta = lcFetchMetaRaw(id)
  rating = invalid
  if meta <> invalid then rating = Val(lcAaText(meta, "imdbRating"))
  out = { imdbId: id, imdbUrl: "https://www.imdb.com/title/" + id + "/", rating: rating, source: invalid, sourceUrl: invalid, average: invalid, reviews: [] }
  if meta <> invalid and lcAaText(meta, "type", "movie") = "movie"
    res = lcHttp("https://letterboxd.com/imdb/" + id + "/", "GET", "", {}, 4000)
    if res.ok
      canonical = CreateObject("roRegex", "https://letterboxd.com/film/[^/" + Chr(34) + " ]+/", "i").Match(Left(res.body, 100000))
      if canonical.Count() > 0
        film = canonical[0]
        reviews = lcHttp(film + "reviews/by/activity/", "GET", "", {}, 4000)
        if reviews.ok
          blocks = Left(reviews.body, 400000).Split("film-detail-content")
          for each block in blocks
            author = CreateObject("roRegex", "<[^>]*class=" + Chr(34) + "[^" + Chr(34) + "]*name[^" + Chr(34) + "]*" + Chr(34) + "[^>]*>([^<]+)", "i").Match(block)
            body = CreateObject("roRegex", "<div[^>]*class=" + Chr(34) + "[^" + Chr(34) + "]*body-text[^" + Chr(34) + "]*" + Chr(34) + "[^>]*>([\s\S]*?)</div>", "i").Match(block)
            stars = CreateObject("roRegex", "rated-([0-9]+)", "i").Match(block)
            if author.Count() > 1 and body.Count() > 1
              text = lcHtmlText(body[1])
              score = invalid
              if stars.Count() > 1 then score = Val(stars[1]) / 2
              if Len(text) > 0 then out.reviews.Push({ author: lcHtmlText(author[1]), stars: score, text: Left(text, 900), likes: invalid, url: film })
              if out.reviews.Count() >= 3 then exit for
            end if
          end for
          if out.reviews.Count() > 0
            out.source = "letterboxd"
            out.sourceUrl = film
          end if
        end if
      end if
    end if
  end if
  lcWriteTmpJson("tvm_reviews_" + id + ".json", out)
  return out
end function
