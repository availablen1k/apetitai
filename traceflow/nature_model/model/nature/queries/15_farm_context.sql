WITH areas AS (
 SELECT farm_id,COUNT(*) AS parcel_count,COUNT(DISTINCT catchment_id) AS catchment_count,
        SUM(area_ha) AS mapped_farm_area_ha FROM parcel GROUP BY farm_id
)
SELECT f.farm_id AS result_key,f.*,COALESCE(a.parcel_count,0) AS parcel_count,
       COALESCE(a.catchment_count,0) AS catchment_count,ROUND(a.mapped_farm_area_ha,2) AS mapped_farm_area_ha
FROM farm f LEFT JOIN areas a USING(farm_id)
WHERE (:farm_id IS NULL OR f.farm_id=:farm_id) AND (:country IS NULL OR f.country=:country)
ORDER BY f.farm_id LIMIT :limit OFFSET :offset;
