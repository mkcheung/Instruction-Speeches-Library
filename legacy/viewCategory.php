<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("category.php");
require_once("topic.php");
require_once("function.php");
require_once("Session.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
// $category = Category::find_by_id($_GET['id']);
$allCategories = Category::find_all();
$topics = Topic::find_by_category_id($category->id);
?>

<div class="container-fluid">
	<div class="row-fluid">
		<div id="listOfCategorySpeeches" class="span3">
			<ul class="nav nav-list navMenu">
			 	<li class="nav-header">
			 		Toastmasters Library
			 	</li>
				<li>
					<a href="logout.php">Logout</a>
				</li>
				<li>
					<a href="index.php">Back To Main</a>
				</li>
				<li class="nav-header">Competent Communicator</li>
				<?php
					if(!is_null($allCategories)){
						foreach($allCategories as $aCategory){
							echo "<li>";
							echo "<a tabindex='-1' id='viewCategory-$aCategory->id' href='viewCategory.php?id=$aCategory->id'>" . $aCategory->category_title .'</a>';
							echo "</li>";	
							?>
							<script>
								$('#listOfCategorySpeeches a#viewCategory-<?=$aCategory->id?>').bind('click', function(e){
									e.preventDefault();
									$.ajax({
										type:'POST',
										url: 'categoryAffiliatedSpeechListing.php',
										data:{categoryId:'<?=$aCategory->id?>'},
										cache: false,
										timeout:7000,
										processData:true,
										success: function(data){
											relatedCategorySpeeches = $("<div>").html(data).find('#listingOfIndividualSpeeches').html();
											$('#categoryIndividualSpeeches').html(relatedCategorySpeeches);
										}
									});
								});
							</script>
							<?php
						}
					} else {
						echo "<li>";
						echo "<a tabindex=\"-1\" href=\"#\">No Categories</a>";
						echo "</li>";
					}
				?>
			</ul>
		</div>
		<div id="categoryIndividualSpeeches" class="span9">
			<div class="row-fluid">
				<div class="span1">
				</div>
				<div class="span9">
					<!-- <img src="../img/17685362_m.jpg" width="700" class="pull-right"/> -->
	 				<!-- <img src="../img/13602313_m.jpg"  width="800" />  -->
					<!--  <img src="../img/18722406_m.jpg" width="950"/>  -->
					<img src="../img/17685556_m.jpg" /> 
				</div>
				<div class="span2">
				</div>
			</div>
		</div>
	</div>
</div>

<?php
	include_once('footer.php');
?>